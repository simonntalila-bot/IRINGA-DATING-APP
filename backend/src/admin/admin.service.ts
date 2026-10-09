import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AdminRole, LocationKind, PlaceCategorySlug } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { slugify } from '../common/utils/random.util';

/**
 * Admin operations that must always be audited.
 *
 * This is the piece that makes the Iringa location database growable: areas,
 * villages, streets and dating places are added here, so nothing about Iringa
 * is hard-coded in the application.
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(
    adminId: string | null,
    action: string,
    entityType: string,
    entityId?: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.adminLog.create({
      data: { adminId, action, entityType, entityId, meta: meta as never },
    });
  }

  async dashboard() {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 86_400_000);
    const monthAgo = new Date(now.getTime() - 30 * 86_400_000);

    const [
      totalUsers,
      newUsersToday,
      activeToday,
      activeMonth,
      matches,
      messages,
      reportsOpen,
      areas,
      places,
      verifiedPlaces,
      subscriptions,
    ] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { createdAt: { gte: dayAgo } } }),
      this.prisma.user.count({ where: { lastSeenAt: { gte: dayAgo } } }),
      this.prisma.user.count({ where: { lastSeenAt: { gte: monthAgo } } }),
      this.prisma.match.count({ where: { state: 'ACTIVE' } }),
      this.prisma.message.count({ where: { createdAt: { gte: dayAgo } } }),
      this.prisma.report.count({ where: { status: { in: ['OPEN', 'IN_REVIEW'] } } }),
      this.prisma.locationNode.count({ where: { isActive: true } }),
      this.prisma.locationPlace.count({ where: { isActive: true } }),
      this.prisma.locationPlace.count({ where: { isActive: true, isVerified: true } }),
      this.prisma.subscription.count({ where: { status: 'ACTIVE', tier: { not: 'FREE' } } }),
    ]);

    // Aggregate only. No raw coordinates are exposed in analytics.
    const areaDistribution = await this.prisma.locationNode.findMany({
      where: { kind: 'AREA', isActive: true },
      select: {
        id: true,
        name: true,
        _count: { select: { usersHere: true } },
      },
      orderBy: { name: 'asc' },
    });

    return {
      users: { total: totalUsers, newToday: newUsersToday, dailyActive: activeToday, monthlyActive: activeMonth },
      engagement: { activeMatches: matches, messagesToday: messages },
      moderation: { openReports: reportsOpen },
      locations: { areas: areas, places, verifiedPlaces },
      revenue: { activeSubscriptions: subscriptions },
      areaDistribution: areaDistribution.map((a) => ({ areaId: a.id, name: a.name, users: a._count.usersHere })),
      generatedAt: now.toISOString(),
    };
  }

  // --- Location nodes (district -> ward -> area -> village -> street) -----

  async createNode(
    adminId: string,
    input: {
      regionSlug?: string;
      parentId?: string;
      kind: LocationKind;
      name: string;
      description?: string;
      centerLat?: number;
      centerLng?: number;
      radiusM?: number;
      boundary?: unknown;
      sortOrder?: number;
    },
  ) {
    const region = await this.prisma.supportedRegion.findUnique({
      where: { slug: input.regionSlug ?? 'iringa' },
    });
    if (!region) throw new NotFoundException('Supported region not found');

    const slug = slugify(input.name);

    const node = await this.prisma.locationNode.create({
      data: {
        regionId: region.id,
        parentId: input.parentId ?? null,
        kind: input.kind,
        name: input.name.trim(),
        slug,
        description: input.description,
        centerLat: input.centerLat,
        centerLng: input.centerLng,
        radiusM: input.radiusM,
        boundary: input.boundary as never,
        sortOrder: input.sortOrder ?? 0,
      },
      select: { id: true, name: true, kind: true, slug: true, parentId: true },
    });

    await this.log(adminId, 'location.create', 'LocationNode', node.id, { name: node.name, kind: node.kind });
    this.logger.log(`Location node created: ${node.kind} ${node.name}`);
    return node;
  }

  async updateNode(
    adminId: string,
    nodeId: string,
    input: Partial<{
      name: string;
      description: string;
      centerLat: number;
      centerLng: number;
      radiusM: number;
      boundary: unknown;
      isActive: boolean;
      sortOrder: number;
    }>,
  ) {
    const node = await this.prisma.locationNode.update({
      where: { id: nodeId },
      data: {
        ...(input.name ? { name: input.name.trim(), slug: slugify(input.name) } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.centerLat !== undefined ? { centerLat: input.centerLat } : {}),
        ...(input.centerLng !== undefined ? { centerLng: input.centerLng } : {}),
        ...(input.radiusM !== undefined ? { radiusM: input.radiusM } : {}),
        ...(input.boundary !== undefined ? { boundary: input.boundary as never } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
      select: { id: true, name: true, isActive: true },
    });

    await this.log(adminId, 'location.update', 'LocationNode', nodeId, input as Record<string, unknown>);
    return node;
  }

  async setNodeActive(adminId: string, nodeId: string, isActive: boolean) {
    return this.updateNode(adminId, nodeId, { isActive });
  }

  async deleteNode(adminId: string, nodeId: string): Promise<void> {
    // Soft delete: profiles keep pointing at a valid node id.
    await this.prisma.locationNode.update({ where: { id: nodeId }, data: { isActive: false } });
    await this.log(adminId, 'location.disable', 'LocationNode', nodeId);
  }

  // --- Places -------------------------------------------------------------

  async createPlace(
    adminId: string,
    input: {
      regionSlug?: string;
      nodeId?: string;
      categorySlug: PlaceCategorySlug;
      name: string;
      description?: string;
      address?: string;
      latitude: number;
      longitude: number;
      radiusM?: number;
      openingHours?: unknown;
      phone?: string;
      website?: string;
      isDatingFriendly?: boolean;
      isVerified?: boolean;
      sourceNote?: string;
    },
  ) {
    const [region, category] = await Promise.all([
      this.prisma.supportedRegion.findUnique({ where: { slug: input.regionSlug ?? 'iringa' } }),
      this.prisma.placeCategory.findUnique({ where: { slug: input.categorySlug } }),
    ]);
    if (!region) throw new NotFoundException('Supported region not found');
    if (!category) throw new NotFoundException('Place category not found');

    const place = await this.prisma.locationPlace.create({
      data: {
        regionId: region.id,
        nodeId: input.nodeId,
        categoryId: category.id,
        name: input.name.trim(),
        slug: slugify(input.name),
        description: input.description,
        address: input.address,
        latitude: input.latitude,
        longitude: input.longitude,
        radiusM: input.radiusM ?? 150,
        openingHours: input.openingHours as never,
        phone: input.phone,
        website: input.website,
        isDatingFriendly: input.isDatingFriendly ?? false,
        isVerified: input.isVerified ?? false,
        sourceNote: input.sourceNote,
      },
      select: { id: true, name: true, slug: true, isActive: true },
    });

    // Every place gets a geofence so "you are near X" can work immediately.
    await this.prisma.geofence.create({
      data: {
        regionId: region.id,
        nodeId: input.nodeId,
        placeId: place.id,
        name: place.name,
        latitude: input.latitude,
        longitude: input.longitude,
        radiusM: input.radiusM ?? 150,
      },
    });

    await this.log(adminId, 'place.create', 'LocationPlace', place.id, { name: place.name });
    return place;
  }

  async updatePlace(
    adminId: string,
    placeId: string,
    input: Partial<{
      name: string;
      description: string;
      address: string;
      latitude: number;
      longitude: number;
      radiusM: number;
      openingHours: unknown;
      phone: string;
      website: string;
      isDatingFriendly: boolean;
      isVerified: boolean;
      isActive: boolean;
      sourceNote: string;
    }>,
  ) {
    const place = await this.prisma.locationPlace.update({
      where: { id: placeId },
      data: {
        ...(input.name ? { name: input.name.trim(), slug: slugify(input.name) } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
        ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
        ...(input.radiusM !== undefined ? { radiusM: input.radiusM } : {}),
        ...(input.openingHours !== undefined ? { openingHours: input.openingHours as never } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.website !== undefined ? { website: input.website } : {}),
        ...(input.isDatingFriendly !== undefined ? { isDatingFriendly: input.isDatingFriendly } : {}),
        ...(input.isVerified !== undefined ? { isVerified: input.isVerified } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.sourceNote !== undefined ? { sourceNote: input.sourceNote } : {}),
      },
      select: { id: true, name: true, isActive: true },
    });

    await this.prisma.geofence.updateMany({ where: { placeId }, data: { isActive: input.isActive ?? true } });
    await this.log(adminId, 'place.update', 'LocationPlace', placeId, input as Record<string, unknown>);
    return place;
  }

  async listRegions() {
    return this.prisma.supportedRegion.findMany({
      select: { id: true, slug: true, name: true, countryCode: true, centerLat: true, centerLng: true, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async setRegionActive(adminId: string, regionId: string, isActive: boolean) {
    const region = await this.prisma.supportedRegion.update({
      where: { id: regionId },
      data: { isActive },
      select: { id: true, slug: true, isActive: true },
    });
    await this.log(adminId, 'region.toggle', 'SupportedRegion', regionId, { isActive });
    return region;
  }

  async setRegionBoundary(adminId: string, regionId: string, boundary: unknown) {
    const region = await this.prisma.supportedRegion.update({
      where: { id: regionId },
      data: { boundary: boundary as never },
      select: { id: true, slug: true },
    });
    await this.log(adminId, 'region.boundary', 'SupportedRegion', regionId);
    return region;
  }

  async adminRoleFor(userId: string): Promise<AdminRole | null> {
    const admin = await this.prisma.adminUser.findFirst({
      where: { userId, isActive: true },
      select: { role: true },
    });
    return admin?.role ?? null;
  }
}
