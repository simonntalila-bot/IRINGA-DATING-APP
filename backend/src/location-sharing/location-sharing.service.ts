import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LocationShareStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { EntitlementService } from '../entitlements/entitlement.service';
import { PrivacyService } from '../privacy/privacy.service';
import { UsersService } from '../users/users.service';

export const ALLOWED_SHARE_MINUTES = [15, 30, 60, 120, 1440];

/**
 * Temporary live location sharing (spec sections 7, 35).
 *
 * A payment never unlocks live location. The flow is:
 *
 *   recipient requests -> owner receives a request -> owner accepts with a
 *   duration -> an ACTIVE LocationSharePermission exists with its own expiry
 *   -> owner can stop it at any time -> the recipient loses access immediately.
 *
 * The permission is checked on every read, so "stop" is not a client-side
 * promise, it is a row that stops matching.
 */
@Injectable()
export class LocationSharingService {
  private readonly logger = new Logger(LocationSharingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly privacy: PrivacyService,
    private readonly entitlements: EntitlementService,
    private readonly users: UsersService,
  ) {}

  async settings(ownerId: string) {
    const privacy = await this.privacy.settings(ownerId);
    return {
      allowLocationRequests: privacy.allowLocationRequests,
      maxShareMinutes: privacy.maxShareMinutes,
    };
  }

  /** Recipient asks. Nothing is shared yet - the owner has to accept. */
  async request(requesterId: string, ownerId: string, minutes: number, note?: string) {
    if (requesterId === ownerId) throw new BadRequestException('You cannot request your own location');
    await this.users.assertCanInteract(requesterId, ownerId);

    if (!ALLOWED_SHARE_MINUTES.includes(minutes)) {
      throw new BadRequestException(`Duration must be one of: ${ALLOWED_SHARE_MINUTES.join(', ')} minutes`);
    }
    if (!(await this.privacy.ownerAllowsLocationRequests(ownerId))) {
      throw new ForbiddenException({
        message: 'This person is not accepting location requests',
        code: 'OWNER_DECLINED_REQUESTS',
      });
    }

    const existing = await this.prisma.locationShare.findUnique({
      where: { ownerId_requesterId: { ownerId, requesterId: requesterId } },
      select: { id: true, status: true },
    });

    if (existing?.status === 'ACCEPTED') {
      return { shareId: existing.id, status: existing.status, alreadyActive: true };
    }

    const share = existing
      ? await this.prisma.locationShare.update({
          where: { id: existing.id },
          data: { status: LocationShareStatus.PENDING, requestedMinutes: minutes, note, decidedAt: null },
          select: { id: true, status: true },
        })
      : await this.prisma.locationShare.create({
          data: { ownerId, requesterId: requesterId, requestedMinutes: minutes, note },
          select: { id: true, status: true },
        });

    return { shareId: share.id, status: share.status, alreadyActive: false };
  }

  /** Owner decides. Duration is clamped to their own configured maximum. */
  async respond(ownerId: string, shareId: string, accept: boolean, minutes?: number) {
    const share = await this.prisma.locationShare.findFirst({
      where: { id: shareId, ownerId },
      select: {
        id: true,
        requesterId: true,
        status: true,
        requestedMinutes: true,
        permission: { select: { id: true } },
      },
    });
    if (!share) throw new NotFoundException('Location request not found');

    if (!accept) {
      await this.prisma.locationShare.update({
        where: { id: shareId },
        data: { status: LocationShareStatus.DECLINED, decidedAt: new Date() },
      });
      return { status: LocationShareStatus.DECLINED };
    }

    const privacy = await this.privacy.settings(ownerId);
    const requested = minutes ?? share.requestedMinutes;
    const effective = Math.min(requested, privacy.maxShareMinutes);

    if (!ALLOWED_SHARE_MINUTES.includes(effective)) {
      throw new BadRequestException(`Duration must be one of: ${ALLOWED_SHARE_MINUTES.join(', ')} minutes`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.locationShare.update({
        where: { id: shareId },
        data: { status: LocationShareStatus.ACCEPTED, decidedAt: new Date() },
      });

      if (share.permission) {
        await tx.locationSharePermission.update({
          where: { id: share.permission.id },
          data: {
            expiresAt: new Date(Date.now() + effective * 60_000),
            endedAt: null,
            endReason: null,
            grantedAt: new Date(),
          },
        });
      } else {
        await tx.locationSharePermission.create({
          data: {
            shareId,
            ownerId,
            recipientId: share.requesterId,
            expiresAt: new Date(Date.now() + effective * 60_000),
          },
        });
      }
    });

    this.logger.log(`${ownerId} granted ${effective} minutes of live location to ${share.requesterId}`);
    return {
      status: LocationShareStatus.ACCEPTED,
      minutes: effective,
      expiresAt: new Date(Date.now() + effective * 60_000).toISOString(),
    };
  }

  /** Owner stops sharing immediately. */
  async stop(ownerId: string, recipientId: string) {
    const permission = await this.prisma.locationSharePermission.findFirst({
      where: { ownerId, recipientId, endedAt: null },
      select: { id: true, shareId: true },
    });
    if (!permission) return { stopped: false };

    await this.prisma.$transaction([
      this.prisma.locationSharePermission.update({
        where: { id: permission.id },
        data: { endedAt: new Date(), endReason: 'Stopped by owner' },
      }),
      this.prisma.locationShare.update({
        where: { id: permission.shareId },
        data: { status: LocationShareStatus.REVOKED },
      }),
    ]);

    this.logger.log(`${ownerId} stopped live location sharing with ${recipientId}`);
    return { stopped: true };
  }

  /**
   * The recipient's live position. Returns 403 unless there is an active
   * permission - this is the only place a live coordinate is ever returned,
   * and only to a specific recipient who was granted it.
   */
  async livePosition(
    viewerId: string,
    ownerId: string,
  ): Promise<{
    areaName: string;
    accuracyM: number | null;
    sharedUntil: string;
    minutesRemaining: number;
  }> {
    const allowed = await this.entitlements.canUseLiveLocation(viewerId, ownerId);
    if (!allowed) {
      throw new ForbiddenException({
        message: 'Live location is not shared with you',
        code: 'LOCATION_SHARE_INACTIVE',
      });
    }

    const permission = await this.prisma.locationSharePermission.findFirst({
      where: { ownerId, recipientId: viewerId, endedAt: null, expiresAt: { gt: new Date() } },
      select: { expiresAt: true },
    });
    const location = await this.prisma.userLocation.findUnique({
      where: { userId: ownerId },
      select: { accuracyM: true, recordedAt: true, areaNode: { select: { name: true } } },
    });

    return {
      // Still an AREA name, not a raw coordinate: the recipient gets a map pin
      // resolution the client derives from their own geolocation, not the
      // owner's exact fix.
      areaName: location?.areaNode?.name ?? 'Unknown area',
      accuracyM: location?.accuracyM ?? null,
      sharedUntil: permission?.expiresAt.toISOString() ?? '',
      minutesRemaining: permission
        ? Math.max(0, Math.round((permission.expiresAt.getTime() - Date.now()) / 60_000))
        : 0,
    };
  }

  /** Who can currently see my location? Shown on the owner's privacy screen. */
  async activeRecipients(ownerId: string) {
    const permissions = await this.prisma.locationSharePermission.findMany({
      where: { ownerId, endedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        recipientId: true,
        grantedAt: true,
        expiresAt: true,
        recipient: { select: { profile: { select: { displayName: true } } } },
      },
    });

    return permissions.map((p) => ({
      permissionId: p.id,
      recipientName: p.recipient.profile?.displayName ?? 'Unknown',
      grantedAt: p.grantedAt,
      expiresAt: p.expiresAt,
      minutesRemaining: Math.max(0, Math.round((p.expiresAt.getTime() - Date.now()) / 60_000)),
    }));
  }

  /** Incoming requests for the owner to answer. */
  async incomingRequests(ownerId: string) {
    return this.prisma.locationShare.findMany({
      where: { ownerId, status: LocationShareStatus.PENDING },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        requestedMinutes: true,
        note: true,
        createdAt: true,
        requester: { select: { profile: { select: { displayName: true } } } },
      },
    });
  }

  /** Job: mark finished grants as expired so the UI is accurate. */
  async purgeExpired(): Promise<number> {
    const result = await this.prisma.locationSharePermission.updateMany({
      where: { endedAt: null, expiresAt: { lt: new Date() } },
      data: { endedAt: new Date(), endReason: 'Expired' },
    });
    if (result.count > 0) {
      await this.prisma.locationShare.updateMany({
        where: { status: LocationShareStatus.ACCEPTED },
        data: { status: LocationShareStatus.EXPIRED },
      });
    }
    return result.count;
  }
}
