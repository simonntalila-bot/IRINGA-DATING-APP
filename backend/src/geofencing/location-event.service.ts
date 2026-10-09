import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../common/config/app-config';
import { RedisService } from '../common/redis/redis.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { describeDistance, haversineMeters, isInsideRadius, type LatLng } from '../common/geo/geo.util';
import { LocationsService, type DetectedArea } from '../locations/locations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';

export interface LocationReportResult {
  accepted: boolean;
  throttled: boolean;
  inSupportedRegion: boolean;
  area: DetectedArea | null;
  reason: string | null;
  distanceText: string;
  alerts: string[];
}

/**
 * Handles every incoming location report:
 *   1. throttle (battery + abuse protection: no continuous GPS spam),
 *   2. Iringa boundary check,
 *   3. resolve the approximate area,
 *   4. persist the minimum necessary location,
 *   5. evaluate geofences and fire ONLY consented notifications.
 */
@Injectable()
export class LocationEventService {
  private readonly logger = new Logger(LocationEventService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
    private readonly locations: LocationsService,
    private readonly notifications: NotificationsService,
    private readonly users: UsersService,
  ) {}

  async handleLocationReport(
    userId: string,
    input: LatLng & { accuracyM?: number; source?: string; save?: boolean },
  ): Promise<LocationReportResult> {
    const throttleKey = `loc:${userId}`;
    const allowed = await this.redis.setIfAbsent(
      throttleKey,
      new Date().toISOString(),
      this.config.locationMinUpdateIntervalSeconds,
    );

    if (!allowed) {
      const existing = await this.currentState(userId);
      return {
        accepted: false,
        throttled: true,
        inSupportedRegion: existing.inSupportedRegion,
        area: existing.area,
        reason: existing.reason,
        distanceText: 'Location updates are limited to save battery',
        alerts: [],
      };
    }

    const detection = await this.locations.detect(input, { accuracyMeters: input.accuracyM });

    if (input.save !== false) {
      await this.persist(userId, input, detection);
    }

    const alerts = await this.evaluateGeofences(userId, input, detection);

    return {
      accepted: true,
      throttled: false,
      inSupportedRegion: detection.inSupportedRegion,
      area: detection.area,
      reason: detection.reason,
      distanceText: describeDistance(detection.distanceToCentreKm).text,
      alerts,
    };
  }

  async handleManualArea(userId: string, nodeId: string, save: boolean): Promise<LocationReportResult> {
    const node = await this.prisma.locationNode.findFirst({ where: { id: nodeId, isActive: true } });
    if (!node) {
      return {
        accepted: false,
        throttled: false,
        inSupportedRegion: false,
        area: null,
        reason: 'Unknown area',
        distanceText: 'Distance unavailable',
        alerts: [],
      };
    }

    const area: DetectedArea = {
      nodeId: node.id,
      name: node.name,
      kind: node.kind,
      slug: node.slug,
      matchedBy: 'MANUAL',
    };

    if (save) {
      // The user picked their area manually, so we keep the last real GPS fix
      // (if any) and only overwrite the resolved area node. We never invent
      // coordinates for a manual selection.
      const existing = await this.prisma.userLocation.findUnique({
        where: { userId },
        select: { latitude: true, longitude: true, accuracyM: true },
      });

      await this.prisma.$transaction(async (tx) => {
        await tx.userPrivacySettings.upsert({
          where: { userId },
          create: { userId },
          update: {},
        });

        if (existing) {
          await tx.userLocation.update({
            where: { userId },
            data: {
              areaNodeId: node.id,
              source: 'manual',
              outsideSupportedRegion: false,
              recordedAt: new Date(),
            },
          });
        }

        await tx.profile.updateMany({
          where: { userId },
          data: { displayedAreaNodeId: node.id },
        });
      });
    }

    return {
      accepted: true,
      throttled: false,
      inSupportedRegion: true,
      area,
      reason: null,
      distanceText: 'Area set manually',
      alerts: [],
    };
  }

  async currentState(userId: string): Promise<{
    inSupportedRegion: boolean;
    area: DetectedArea | null;
    reason: string | null;
  }> {
    const record = await this.prisma.userLocation.findUnique({
      where: { userId },
      include: { areaNode: { select: { id: true, name: true, kind: true, slug: true } } },
    });

    if (!record) {
      return { inSupportedRegion: false, area: null, reason: 'Location not set yet' };
    }

    return {
      inSupportedRegion: !record.outsideSupportedRegion,
      area: record.areaNode
        ? {
            nodeId: record.areaNode.id,
            name: record.areaNode.name,
            kind: record.areaNode.kind,
            slug: record.areaNode.slug,
            matchedBy: 'RADIUS',
          }
        : null,
      reason: record.outsideSupportedRegion ? 'Discovery is available in Iringa only' : null,
    };
  }

  private async persist(
    userId: string,
    input: LatLng & { accuracyM?: number; source?: string },
    detection: Awaited<ReturnType<LocationsService['detect']>>,
  ): Promise<void> {
    const data = {
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyM: input.accuracyM ? Math.round(input.accuracyM) : null,
      areaNodeId: detection.area?.nodeId ?? null,
      outsideSupportedRegion: !detection.inSupportedRegion,
      source: input.source ?? 'gps',
      recordedAt: new Date(),
    };

    await this.prisma.$transaction([
      this.prisma.userLocation.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      }),
      // Only the AREA is exposed on the profile - never the coordinates.
      detection.area
        ? this.prisma.profile.updateMany({
            where: { userId },
            data: { displayedAreaNodeId: detection.area.nodeId },
          })
        : this.prisma.profile.updateMany({ where: { userId }, data: { displayedAreaNodeId: null } }),
      this.prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } }),
    ]);
  }

  /**
   * Geofence evaluation.
   *
   * The only user-facing alert that leaves this method is the "you are near X"
   * notice, and only when the user explicitly enabled place alerts.
   * "Your match is around Kihesa" notifications are emitted by the notifications
   * service and require consent on BOTH sides.
   */
  private async evaluateGeofences(
    userId: string,
    point: LatLng,
    detection: Awaited<ReturnType<LocationsService['detect']>>,
  ): Promise<string[]> {
    const alerts: string[] = [];
    if (!detection.inSupportedRegion) return alerts;

    const region = await this.locations.activeRegion();
    if (!region) return alerts;

    const geofences = await this.prisma.geofence.findMany({
      where: { regionId: region.id, isActive: true },
      include: { place: { select: { id: true, name: true } }, node: { select: { name: true } } },
    });

    const matched = geofences.filter((fence) =>
      isInsideRadius(point, { latitude: fence.latitude, longitude: fence.longitude }, fence.radiusM),
    );
    if (matched.length === 0) return alerts;

    const preferences = await this.users.privacySettings(userId);
    const previous = await this.prisma.userLocationEvent.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { geofenceId: true, areaName: true },
    });

    for (const fence of matched) {
      if (previous?.geofenceId === fence.id) continue;

      const label = fence.place?.name ?? fence.node?.name ?? 'a new area';
      await this.prisma.userLocationEvent.create({
        data: {
          userId,
          geofenceId: fence.id,
          nodeId: fence.nodeId,
          areaName: label,
          kind: fence.placeId ? 'PLACE' : 'NODE',
        },
      });

      if (fence.placeId && preferences.allowPlaceAlerts) {
        await this.notifications.notifyAreaArrival(userId, label);
        alerts.push(`You are near ${label}`);
      }

      await this.notifyMatchesAboutArea(userId, label, fence.radiusM, detection.area?.name ?? null);
    }

    return alerts;
  }

  /**
   * "Your match is now around Kihesa."
   *
   * Consent on both sides, matches only, no coordinates, never to blocked
   * users. Nothing is sent unless the user turned it on.
   */
  private async notifyMatchesAboutArea(
    userId: string,
    areaLabel: string,
    fenceRadiusM: number,
    areaName: string | null,
  ): Promise<void> {
    const ownerPrefs = await this.users.privacySettings(userId);
    if (!ownerPrefs.allowAreaActivityAlerts || !ownerPrefs.shareAreaWithMatches) return;
    if (ownerPrefs.locationVisibility === 'HIDDEN') return;

    const matches = await this.prisma.match.findMany({
      where: {
        state: 'ACTIVE',
        participants: { some: { userId } },
      },
      select: {
        id: true,
        userAId: true,
        userBId: true,
        userA: { select: { id: true } },
        userB: { select: { id: true } },
      },
    });

    for (const match of matches) {
      const recipientId = match.userAId === userId ? match.userBId : match.userAId;
      if (recipientId === userId) continue;

      if (await this.users.isBlockedEitherWay(userId, recipientId)) continue;

      const recipientPrefs = await this.users.privacySettings(recipientId);
      if (!recipientPrefs.allowAreaActivityAlerts || !recipientPrefs.shareAreaWithMatches) continue;
      if (recipientPrefs.locationVisibility === 'HIDDEN') continue;

      // Blur the area a little more when the geofence is very small.
      const blur = fenceRadiusM > 1000 && !areaName ? 'this part of Iringa' : areaLabel;

      this.logger.log(`Area activity alert for match ${match.id} -> ${recipientId}`);

      await this.notifications.send({
        userId: recipientId,
        type: 'AREA_ACTIVITY_MATCH',
        title: 'Nearby in Iringa',
        body: `Your match is now around ${blur}.`,
        data: { matchId: match.id, area: blur },
      });
    }
  }

  /** Used by tests and background jobs: distance to a configured place. */
  async distanceToPlace(userId: string, placeId: string): Promise<number | null> {
    const [userLocation, place] = await Promise.all([
      this.prisma.userLocation.findUnique({ where: { userId } }),
      this.prisma.locationPlace.findUnique({ where: { id: placeId }, select: { latitude: true, longitude: true } }),
    ]);
    if (!userLocation || !place) return null;
    return haversineMeters(userLocation, place);
  }
}
