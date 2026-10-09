import { Injectable } from '@nestjs/common';
import type { LocationKind, Prisma } from '@prisma/client';
import { AppConfig } from '../common/config/app-config';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  boundingBoxAround,
  haversineKm,
  isInsideAnyPolygon,
  isInsideRadius,
  isValidLatLng,
  type LatLng,
} from '../common/geo/geo.util';

export interface DetectedArea {
  nodeId: string;
  name: string;
  kind: LocationKind;
  slug: string;
  /** How the area was determined - useful for debugging GPS accuracy issues. */
  matchedBy: 'POLYGON' | 'RADIUS' | 'NEAREST_CENTRE' | 'MANUAL' | 'NONE';
}

export interface DetectResult {
  inSupportedRegion: boolean;
  region: { slug: string; name: string } | null;
  area: DetectedArea | null;
  distanceToCentreKm: number;
  /** Human readable reason shown to the user when discovery is unavailable. */
  reason: string | null;
}

/** Nodes smaller than this are preferred over district-level fallbacks. */
const KIND_PRIORITY: Record<LocationKind, number> = {
  STREET: 0,
  VILLAGE: 1,
  AREA: 2,
  WARD: 3,
  MUNICIPALITY: 4,
  DISTRICT: 5,
};

export interface LocationNodeTree {
  id: string;
  name: string;
  slug: string;
  kind: LocationKind;
  description: string | null;
  children: LocationNodeTree[];
}

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async activeRegion() {
    const region = await this.prisma.supportedRegion.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    return region;
  }

  /**
   * Iringa-only scope check.
   *
   * GPS alone is unreliable, so the decision combines:
   *   1. the configured region boundary polygon (authoritative), and
   *   2. the distance to the region centre (tolerant fallback), and
   *   3. the nearest configured location node (works even before a boundary
   *      has been entered by an admin).
   */
  async detect(point: LatLng, opts: { accuracyMeters?: number } = {}): Promise<DetectResult> {
    const region = await this.activeRegion();
    const distanceToCentreKm = haversineKm(point, {
      latitude: region?.centerLat ?? this.config.iringaCenterLat,
      longitude: region?.centerLng ?? this.config.iringaCenterLng,
    });

    if (!region) {
      return {
        inSupportedRegion: false,
        region: null,
        area: null,
        distanceToCentreKm,
        reason: 'No supported region is configured yet',
      };
    }

    const insidePolygon = isInsideAnyPolygon(point, region.boundary);
    const area = await this.resolveArea(point, region.id);

    // With a configured boundary the polygon wins. Without one, we accept a
    // GPS reading inside the default radius (optionally widened by the reported
    // accuracy, because a 500 m error should not push a user out of scope).
    const maxRadius = region.defaultRadiusKm;
    const accuracyKm = Math.max(0, opts.accuracyMeters ?? 0) / 1000;
    const insideRadius = distanceToCentreKm <= maxRadius + accuracyKm;

    const inSupportedRegion = region.boundary ? insidePolygon || (insideRadius && !!area) : insideRadius;

    return {
      inSupportedRegion,
      region: { slug: region.slug, name: region.name },
      area,
      distanceToCentreKm: Math.round(distanceToCentreKm * 10) / 10,
      reason: inSupportedRegion ? null : `This dating app is currently available in ${region.name} only.`,
    };
  }

  /**
   * Resolve the smallest configured node that contains the point.
   * Nodes with a polygon are tested first (exact), then radius nodes, and
   * finally the nearest centre as a last resort.
   */
  async resolveArea(point: LatLng, regionId?: string): Promise<DetectedArea | null> {
    if (!isValidLatLng(point)) return null;

    const region = regionId
      ? await this.prisma.supportedRegion.findUnique({ where: { id: regionId } })
      : await this.activeRegion();
    if (!region) return null;

    const box = boundingBoxAround(point, 60);
    const candidates = await this.prisma.locationNode.findMany({
      where: {
        regionId: region.id,
        isActive: true,
        AND: [
          { OR: [{ centerLat: { gte: box.minLat, lte: box.maxLat } }, { centerLat: null }] },
          { OR: [{ centerLng: { gte: box.minLng, lte: box.maxLng } }, { centerLng: null }] },
        ],
      },
      select: {
        id: true,
        name: true,
        slug: true,
        kind: true,
        centerLat: true,
        centerLng: true,
        radiusM: true,
        boundary: true,
      },
    });

    const polygonHits = candidates
      .filter((n) => n.boundary && isInsideAnyPolygon(point, n.boundary))
      .sort(bySpecificity);

    const radiusHits = candidates
      .filter(
        (n) =>
          !n.boundary &&
          n.centerLat != null &&
          n.centerLng != null &&
          isInsideRadius(point, { latitude: n.centerLat, longitude: n.centerLng }, n.radiusM ?? 1000),
      )
      .sort(bySpecificity);

    const best = polygonHits[0] ?? radiusHits[0];
    if (best) {
      return {
        nodeId: best.id,
        name: best.name,
        kind: best.kind,
        slug: best.slug,
        matchedBy: best.boundary ? 'POLYGON' : 'RADIUS',
      };
    }

    const nearest = candidates
      .filter((n) => n.centerLat != null && n.centerLng != null)
      .map((n) => ({
        node: n,
        km: haversineKm(point, { latitude: n.centerLat as number, longitude: n.centerLng as number }),
      }))
      .sort((a, b) => a.km - b.km)[0];

    if (nearest && nearest.km <= 15) {
      return {
        nodeId: nearest.node.id,
        name: nearest.node.name,
        kind: nearest.node.kind,
        slug: nearest.node.slug,
        matchedBy: 'NEAREST_CENTRE',
      };
    }

    return null;
  }

  async areaTree(regionSlug = 'iringa', parentId?: string | null, depth = 0): Promise<LocationNodeTree[]> {
    const region = await this.prisma.supportedRegion.findUnique({ where: { slug: regionSlug } });
    if (!region) return [];
    // Guard against cycles introduced by bad admin data.
    if (depth > 6) return [];

    const nodes = await this.prisma.locationNode.findMany({
      where: {
        regionId: region.id,
        isActive: true,
        parentId: parentId ?? null,
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, slug: true, kind: true, description: true },
    });

    const withChildren: LocationNodeTree[] = [];
    for (const node of nodes) {
      withChildren.push({
        ...node,
        children: await this.areaTree(regionSlug, node.id, depth + 1),
      });
    }

    return withChildren;
  }

  async listAreas(input: { kind?: LocationKind; search?: string; regionSlug?: string; limit?: number }) {
    const region = await this.prisma.supportedRegion.findUnique({
      where: { slug: input.regionSlug ?? 'iringa' },
    });
    if (!region) return [];

    const where: Prisma.LocationNodeWhereInput = {
      regionId: region.id,
      isActive: true,
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.search ? { name: { contains: input.search, mode: 'insensitive' } } : {}),
    };

    return this.prisma.locationNode.findMany({
      where,
      take: Math.min(input.limit ?? 100, 300),
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true, kind: true, parentId: true, description: true },
    });
  }

  async placeCategories() {
    return this.prisma.placeCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, slug: true, labelEn: true, labelSw: true, emoji: true, isDatingSpot: true },
    });
  }

  async listPlaces(input: {
    regionSlug?: string;
    categorySlug?: string;
    nodeId?: string;
    near?: LatLng;
    radiusKm?: number;
    datingFriendlyOnly?: boolean;
    search?: string;
    limit?: number;
  }) {
    const region = await this.prisma.supportedRegion.findUnique({
      where: { slug: input.regionSlug ?? 'iringa' },
    });
    if (!region) return [];

    const radiusKm = Math.min(Math.max(input.radiusKm ?? 25, 1), 100);
    const box = input.near ? boundingBoxAround(input.near, radiusKm) : null;

    const where: Prisma.LocationPlaceWhereInput = {
      regionId: region.id,
      isActive: true,
      ...(input.nodeId ? { nodeId: input.nodeId } : {}),
      ...(input.datingFriendlyOnly ? { isDatingFriendly: true } : {}),
      ...(input.search ? { name: { contains: input.search, mode: 'insensitive' } } : {}),
      ...(input.categorySlug ? { category: { slug: input.categorySlug as never } } : {}),
      ...(box
        ? {
            AND: [
              { latitude: { gte: box.minLat, lte: box.maxLat } },
              { longitude: { gte: box.minLng, lte: box.maxLng } },
            ],
          }
        : {}),
    };

    const places = await this.prisma.locationPlace.findMany({
      where,
      take: Math.min(input.limit ?? 60, 200),
      orderBy: { name: 'asc' },
      include: {
        category: { select: { slug: true, labelEn: true, labelSw: true, emoji: true, isDatingSpot: true } },
        node: { select: { id: true, name: true, kind: true } },
      },
    });

    return places.map((place) => ({
      id: place.id,
      slug: place.slug,
      name: place.name,
      description: place.description,
      address: place.address,
      latitude: place.latitude,
      longitude: place.longitude,
      radiusM: place.radiusM,
      openingHours: place.openingHours,
      phone: place.phone,
      website: place.website,
      isDatingFriendly: place.isDatingFriendly,
      isVerified: place.isVerified,
      category: place.category,
      area: place.node,
      // Place coordinates are public business information - this is the only
      // latitude/longitude in the whole app that is safe to expose.
      distanceKm: input.near
        ? Math.round(haversineKm(input.near, { latitude: place.latitude, longitude: place.longitude }) * 10) / 10
        : null,
    }));
  }

  async placeDetail(idOrSlug: string) {
    const place = await this.prisma.locationPlace.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: {
        category: true,
        node: { select: { id: true, name: true, kind: true } },
        photos: { orderBy: { position: 'asc' }, select: { id: true, mediaId: true, position: true } },
      },
    });
    return place;
  }
}

const bySpecificity = <T extends { kind: LocationKind; radiusM: number | null }>(a: T, b: T): number => {
  const priority = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
  if (priority !== 0) return priority;
  return (b.radiusM ?? Number.MAX_SAFE_INTEGER) - (a.radiusM ?? Number.MAX_SAFE_INTEGER);
};
