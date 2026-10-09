import { BadRequestException, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Gender, Prisma } from '@prisma/client';
import { AppConfig } from '../common/config/app-config';
import { boundingBoxAround, haversineKm, type LatLng } from '../common/geo/geo.util';
import { buildApproximateLocationView } from '../common/geo/privacy.util';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { calculateAge } from '../common/utils/age.util';
import { excludeIds } from '../common/utils/block.util';
import { PrivacyService } from '../privacy/privacy.service';
import { UsersService } from '../users/users.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { computeCompatibilityScore, type CompatibilityWeights } from './compatibility.util';
import { relativeTime } from '../profiles/profiles.service';

export type DiscoveryMode = 'nearby' | 'recommended' | 'new' | 'active';

export interface DiscoveryFilters {
  mode?: DiscoveryMode;
  minAge?: number;
  maxAge?: number;
  maxDistanceKm?: number;
  relationshipGoal?: string;
  interests?: string[];
  verifiedOnly?: boolean;
  onlineOnly?: boolean;
  onlyVerified?: boolean;
  onlyActiveRecent?: boolean;
  limit?: number;
  cursor?: string;
}

export interface DiscoveryCandidate {
  userId: string;
  displayName: string;
  age: number;
  gender: Gender;
  relationshipGoal: string;
  bio: string | null;
  photoMediaId: string | null;
  interests: string[];
  areaName: string | null;
  distanceText: string;
  distanceLabel: string;
  compatibilityScore: number;
  commonInterests: string[];
  verifiedPhone: boolean;
  selfieVerified: boolean;
  isOnline: boolean;
  lastActive: string | null;
  boosted: boolean;
}

const candidateSelect = {
  id: true,
  userId: true,
  displayName: true,
  dateOfBirth: true,
  gender: true,
  relationshipGoal: true,
  bio: true,
  languages: true,
  lastActiveAt: true,
  profileCompletePct: true,
  interestLinks: { select: { interest: { select: { slug: true } } } },
  displayedAreaNode: { select: { name: true, kind: true } },
  photos: { orderBy: { position: 'asc' }, take: 1, select: { mediaId: true } },
  user: {
    select: {
      phoneVerifiedAt: true,
      location: { select: { latitude: true, longitude: true } },
      verifications: { where: { status: 'APPROVED' as const }, select: { type: true } },
      boosts: { where: { endsAt: { gt: new Date() } }, take: 1, select: { id: true } },
      privacySettings: { select: { shareAreaWithMatches: true, locationVisibility: true } },
    },
  },
} satisfies Prisma.ProfileSelect;

@Injectable()
export class DiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
    private readonly users: UsersService,
    private readonly subscriptions: SubscriptionsService,
    private readonly privacy: PrivacyService,
  ) {}

  async discover(
    viewerId: string,
    filters: DiscoveryFilters,
  ): Promise<{ items: DiscoveryCandidate[]; nextCursor: string | null }> {
    // Advanced filters are a paid capability (advancedFilters entitlement).
    if (filters.onlyVerified || filters.onlyActiveRecent) {
      await this.subscriptions.requireEntitlement(viewerId, 'advancedFilters');
    }

    const viewer = await this.prisma.profile.findUnique({
      where: { userId: viewerId },
      select: {
        dateOfBirth: true,
        gender: true,
        interestedIn: true,
        relationshipGoal: true,
        languages: true,
        lastActiveAt: true,
        minAge: true,
        maxAge: true,
        interestLinks: { select: { interest: { select: { slug: true } } } },
      },
    });
    if (!viewer) throw new BadRequestException('Complete your profile first');

    // Gender-based discovery (spec section 4). The preference is data, not code:
    // MALE -> FEMALE and FEMALE -> MALE by default, and the user can change it.
    const preference = await this.privacy.discoveryPreference(viewerId);
    const preferredGender: Gender[] = viewer.interestedIn.length > 0 ? viewer.interestedIn : preference.preferredGender;

    const viewerLocation = await this.prisma.userLocation.findUnique({
      where: { userId: viewerId },
      select: { latitude: true, longitude: true, outsideSupportedRegion: true },
    });

    // Iringa-only scope. Outside the served region discovery is unavailable,
    // but the account and its data are untouched (spec section 30).
    if (viewerLocation?.outsideSupportedRegion) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        message: 'Dating discovery is currently available in Iringa only.',
        code: 'OUTSIDE_SUPPORTED_REGION',
      });
    }

    const minAge = filters.minAge ?? viewer.minAge ?? 18;
    const maxAge = filters.maxAge ?? viewer.maxAge ?? 60;
    if (minAge > maxAge) throw new BadRequestException('minAge cannot be greater than maxAge');

    const viewerPrefs = await this.users.privacySettings(viewerId);
    const radiusKm = Math.min(
      filters.maxDistanceKm ?? viewerPrefs.discoveryRadiusKm ?? this.config.discoveryDefaultRadiusKm,
      200,
    );

    const map = await this.users.blockMap(viewerId);
    const excluded = excludeIds(map, [
      viewerId,
      ...(await this.swipedIds(viewerId)),
      ...(await this.matchedIds(viewerId)),
    ]);
    if (excluded.length === 0) return { items: [], nextCursor: null };

    // A goal filter is a refinement, not a licence to see everyone.
    const interestedIn: Gender[] = filters.relationshipGoal ? preferredGender : preferredGender;

    const and: Prisma.ProfileWhereInput[] = [
      {
        userId: { notIn: excluded },
        user: { status: 'ACTIVE', deletedAt: null },
        dateOfBirth: { gte: oldestAllowedDate(maxAge), lte: youngestAllowedDate(minAge) },
        ...(interestedIn.length > 0 ? { gender: { in: interestedIn } } : {}),
        ...(filters.relationshipGoal ? { relationshipGoal: filters.relationshipGoal as never } : {}),
        ...(filters.mode === 'new' ? { createdAt: { gte: daysAgo(14) } } : {}),
        ...(filters.mode === 'active' ? { lastActiveAt: { gte: daysAgo(3) } } : {}),
        ...(filters.interests?.length
          ? { interestLinks: { some: { interest: { slug: { in: filters.interests } } } } }
          : {}),
      },
    ];

    // Bounding box pre-filter: without it PostgreSQL would compare every row.
    if (viewerLocation) {
      const box = boundingBoxAround(viewerLocation as LatLng, radiusKm);
      and.push({
        user: {
          location: {
            is: {
              AND: [
                { latitude: { gte: box.minLat, lte: box.maxLat } },
                { longitude: { gte: box.minLng, lte: box.maxLng } },
              ],
            },
          },
        },
      });
    }

    const take = Math.min(filters.limit ?? 20, 50);

    const profiles = await this.prisma.profile.findMany({
      where: { AND: and },
      take: take * 3,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      orderBy: this.orderFor(filters.mode ?? 'recommended'),
      select: candidateSelect,
    });

    const weights: CompatibilityWeights = this.config.compatWeights;
    const viewerInterests = viewer.interestLinks.map((l) => l.interest.slug);

    const scored: DiscoveryCandidate[] = [];
    for (const profile of profiles) {
      const targetLocation = profile.user.location;
      const distanceKm =
        viewerLocation && targetLocation ? haversineKm(viewerLocation as LatLng, targetLocation) : null;

      if (distanceKm != null && distanceKm > radiusKm) continue;

      const verifiedTypes = new Set(profile.user.verifications.map((v) => v.type));
      const verifiedPhone = !!profile.user.phoneVerifiedAt || verifiedTypes.has('PHONE');
      if (filters.onlyVerified && !verifiedPhone && !verifiedTypes.has('SELFIE')) continue;
      if (
        filters.onlyActiveRecent &&
        (!profile.lastActiveAt || Date.now() - profile.lastActiveAt.getTime() > 3 * 86_400_000)
      ) {
        continue;
      }

      const isOnline = await this.redis.isUserOnline(profile.userId);
      if (filters.onlineOnly && !isOnline) continue;

      const compatibility = computeCompatibilityScore(
        {
          ageA: calculateAge(viewer.dateOfBirth),
          ageB: calculateAge(profile.dateOfBirth),
          goalA: viewer.relationshipGoal,
          goalB: profile.relationshipGoal,
          interestSlugsA: viewerInterests,
          interestSlugsB: profile.interestLinks.map((l) => l.interest.slug),
          languagesA: viewer.languages ?? [],
          languagesB: profile.languages ?? [],
          distanceKm,
          maxDistanceKm: radiusKm,
          lastActiveA: viewer.lastActiveAt,
          lastActiveB: profile.lastActiveAt,
        },
        weights,
      );

      const privacy = profile.user.privacySettings;
      const location = buildApproximateLocationView(
        {
          locationVisibility: privacy?.locationVisibility ?? 'APPROXIMATE_AREA',
          shareAreaWithMatches: privacy?.shareAreaWithMatches ?? false,
        },
        profile.displayedAreaNode
          ? { name: profile.displayedAreaNode.name, kind: profile.displayedAreaNode.kind }
          : null,
        viewerPrefs.shareAreaWithMatches ? distanceKm : null,
        { isMatch: false, isBlockedEitherWay: false },
      );

      scored.push({
        userId: profile.userId,
        displayName: profile.displayName,
        age: calculateAge(profile.dateOfBirth),
        gender: profile.gender,
        relationshipGoal: profile.relationshipGoal,
        bio: profile.bio,
        photoMediaId: profile.photos[0]?.mediaId ?? null,
        interests: profile.interestLinks.map((l) => l.interest.slug),
        areaName: location.areaName,
        distanceText: location.distanceText,
        distanceLabel: location.distanceLabel,
        compatibilityScore: compatibility.score,
        commonInterests: compatibility.commonInterests,
        verifiedPhone,
        selfieVerified: verifiedTypes.has('SELFIE'),
        isOnline,
        lastActive: profile.lastActiveAt ? relativeTime(profile.lastActiveAt) : null,
        boosted: profile.user.boosts.length > 0,
      });
    }

    // Boosted profiles float to the top, then compatibility order applies.
    scored.sort((a, b) => {
      if (a.boosted !== b.boosted) return a.boosted ? -1 : 1;
      return b.compatibilityScore - a.compatibilityScore;
    });

    const page = scored.slice(0, take);
    return {
      items: page,
      nextCursor:
        profiles.length >= take * 3 && page.length === take ? (profiles[profiles.length - 1]?.id ?? null) : null,
    };
  }

  /** Premium: who liked me. Blocked users are excluded. */
  async likesReceived(viewerId: string, limit = 50) {
    // Business rule: this is a paid capability. The gate is server side.
    await this.subscriptions.requireEntitlement(viewerId, 'seeWhoLikedYou');

    const map = await this.users.blockMap(viewerId);
    const allowed = excludeIds(map, [viewerId]);
    if (allowed.length === 0) return [];

    const swipes = await this.prisma.swipe.findMany({
      where: {
        targetId: viewerId,
        type: { in: ['LIKE', 'SUPER_LIKE'] },
        swiperId: { in: allowed },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      select: {
        id: true,
        type: true,
        createdAt: true,
        swiper: {
          select: {
            id: true,
            phoneVerifiedAt: true,
            profile: {
              select: {
                displayName: true,
                dateOfBirth: true,
                relationshipGoal: true,
                bio: true,
                photos: { orderBy: { position: 'asc' }, take: 1, select: { mediaId: true } },
                displayedAreaNode: { select: { name: true, kind: true } },
                user: {
                  select: { privacySettings: { select: { locationVisibility: true, shareAreaWithMatches: true } } },
                },
              },
            },
          },
        },
      },
    });

    return swipes.map((swipe) => {
      const profile = swipe.swiper.profile;
      const privacy = profile?.user.privacySettings;
      const location = buildApproximateLocationView(
        {
          locationVisibility: privacy?.locationVisibility ?? 'APPROXIMATE_AREA',
          shareAreaWithMatches: privacy?.shareAreaWithMatches ?? false,
        },
        profile?.displayedAreaNode
          ? { name: profile.displayedAreaNode.name, kind: profile.displayedAreaNode.kind }
          : null,
        null,
        { isMatch: false, isBlockedEitherWay: false },
      );

      return {
        swipeId: swipe.id,
        type: swipe.type,
        likedAt: swipe.createdAt,
        userId: swipe.swiper.id,
        displayName: profile?.displayName ?? 'Unknown',
        age: profile ? calculateAge(profile.dateOfBirth) : null,
        photoMediaId: profile?.photos[0]?.mediaId ?? null,
        areaName: location.areaName,
        verifiedPhone: !!swipe.swiper.phoneVerifiedAt,
      };
    });
  }

  async undoLastSwipe(viewerId: string): Promise<{ removed: string | null }> {
    const last = await this.prisma.swipe.findFirst({
      where: { swiperId: viewerId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, targetId: true, type: true },
    });
    if (!last) return { removed: null };

    if (last.type !== 'PASS') {
      const match = await this.prisma.match.findFirst({
        where: {
          state: 'ACTIVE',
          participants: { some: { userId: viewerId } },
          OR: [{ userAId: last.targetId }, { userBId: last.targetId }],
        },
        select: { id: true },
      });
      if (match) {
        throw new ForbiddenException('You are matched with this person. Unmatch instead of undoing the swipe.');
      }
    }

    await this.prisma.swipe.delete({ where: { id: last.id } });
    return { removed: last.targetId };
  }

  private orderFor(mode: DiscoveryMode): Prisma.ProfileOrderByWithRelationInput[] {
    switch (mode) {
      case 'new':
        return [{ createdAt: 'desc' }];
      case 'active':
      case 'nearby':
        return [{ lastActiveAt: 'desc' }];
      default:
        return [{ profileCompletePct: 'desc' }, { lastActiveAt: 'desc' }];
    }
  }

  private async swipedIds(viewerId: string): Promise<string[]> {
    const rows = await this.prisma.swipe.findMany({ where: { swiperId: viewerId }, select: { targetId: true } });
    return rows.map((r) => r.targetId);
  }

  private async matchedIds(viewerId: string): Promise<string[]> {
    const rows = await this.prisma.match.findMany({
      where: { state: 'ACTIVE', participants: { some: { userId: viewerId } } },
      select: { userAId: true, userBId: true },
    });
    return rows.map((r) => (r.userAId === viewerId ? r.userBId : r.userAId));
  }
}

const daysAgo = (days: number): Date => new Date(Date.now() - days * 86_400_000);

const oldestAllowedDate = (maxAge: number): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear() - maxAge - 1, now.getUTCMonth(), now.getUTCDate()));
};

const youngestAllowedDate = (minAge: number): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear() - minAge, now.getUTCMonth(), now.getUTCDate()));
};
