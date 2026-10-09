import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { SwipeType } from '@prisma/client';
import { haversineKm } from '../common/geo/geo.util';
import { PrismaService } from '../common/prisma/prisma.service';
import { computeCompatibilityScore } from '../discovery/compatibility.util';
import { calculateAge } from '../common/utils/age.util';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

export interface SwipeResult {
  swipe: SwipeType;
  matched: boolean;
  matchId: string | null;
  compatibilityScore: number | null;
  remainingLikes: number | null;
}

const FREE_DAILY_LIKES = 30;
const FREE_DAILY_SUPER_LIKES = 3;

@Injectable()
export class SwipesService {
  private readonly logger = new Logger(SwipesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async swipe(swiperId: string, targetId: string, type: SwipeType): Promise<SwipeResult> {
    await this.users.assertCanInteract(swiperId, targetId);

    // Idempotent: re-swiping the same person updates the row, it never creates
    // a second swipe and therefore can never create a second match.
    const existing = await this.prisma.swipe.findUnique({
      where: { swiperId_targetId: { swiperId, targetId } },
      select: { id: true, type: true },
    });

    if (type !== 'PASS') {
      await this.assertWithinDailyLimit(swiperId, type);
    }

    await this.prisma.swipe.upsert({
      where: { swiperId_targetId: { swiperId, targetId } },
      create: { swiperId, targetId, type },
      update: { type },
    });

    if (existing?.type === type) {
      // Nothing changed - return the existing match state.
      const existingMatch = await this.findActiveMatch(swiperId, targetId);
      return {
        swipe: type,
        matched: !!existingMatch,
        matchId: existingMatch?.id ?? null,
        compatibilityScore: existingMatch?.compatibilityScore ?? null,
        remainingLikes: null,
      };
    }

    const profile = await this.prisma.profile.findUnique({
      where: { userId: targetId },
      select: { displayName: true },
    });

    if (type === 'LIKE') {
      await this.notifications.send({
        userId: targetId,
        type: 'NEW_LIKE',
        title: 'Someone likes you',
        body: `${profile?.displayName ?? 'Someone'} liked your profile.`,
        data: { fromUserId: swiperId },
      });
    }

    if (type === 'SUPER_LIKE') {
      await this.notifications.send({
        userId: targetId,
        type: 'NEW_SUPER_LIKE',
        title: 'Super like',
        body: `${profile?.displayName ?? 'Someone'} super liked you.`,
        data: { fromUserId: swiperId },
      });
    }

    if (type === 'PASS') {
      const match = await this.findActiveMatch(swiperId, targetId);
      if (match) {
        await this.prisma.match.update({
          where: { id: match.id },
          data: { state: 'UNMATCHED', endedAt: new Date() },
        });
      }
      return { swipe: type, matched: false, matchId: null, compatibilityScore: null, remainingLikes: null };
    }

    const reciprocal = await this.prisma.swipe.findUnique({
      where: { swiperId_targetId: { swiperId: targetId, targetId: swiperId } },
      select: { type: true },
    });

    if (!reciprocal || reciprocal.type === 'PASS') {
      return {
        swipe: type,
        matched: false,
        matchId: null,
        compatibilityScore: null,
        remainingLikes: await this.remainingLikes(swiperId),
      };
    }

    const match = await this.createMatch(swiperId, targetId);

    await this.notifications.send({
      userId: targetId,
      type: 'NEW_MATCH',
      title: "It's a match",
      body: `You and ${profile?.displayName ?? 'someone new'} liked each other. Say hello.`,
      data: { matchId: match.id },
    });
    await this.notifications.send({
      userId: swiperId,
      type: 'NEW_MATCH',
      title: "It's a match",
      body: `You matched with ${profile?.displayName ?? 'someone new'}.`,
      data: { matchId: match.id },
    });

    return {
      swipe: type,
      matched: true,
      matchId: match.id,
      compatibilityScore: match.compatibilityScore,
      remainingLikes: await this.remainingLikes(swiperId),
    };
  }

  /**
   * Mutual like -> exactly one match.
   *
   * `userAId`/`userBId` are stored in a canonical (sorted) order and the pair
   * has a unique constraint, so even two concurrent requests can only ever
   * produce one match row.
   */
  private async createMatch(swiperId: string, targetId: string) {
    const [userAId, userBId] = [swiperId, targetId].sort() as [string, string];

    const score = await this.scoreFor(userAId, userBId);

    const match = await this.prisma.match.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      create: {
        userAId,
        userBId,
        initiatedBy: swiperId,
        compatibilityScore: score,
        participants: { create: [{ userId: userAId }, { userId: userBId }] },
        conversation: {
          create: {
            members: { create: [{ userId: userAId }, { userId: userBId }] },
          },
        },
      },
      update: { state: 'ACTIVE', endedAt: null, compatibilityScore: score },
      select: { id: true, compatibilityScore: true },
    });

    this.logger.log(`Match ${match.id} between ${userAId} and ${userBId}`);
    return match;
  }

  private async scoreFor(userAId: string, userBId: string): Promise<number> {
    const [a, b, locationA, locationB] = await Promise.all([
      this.loadScoringProfile(userAId),
      this.loadScoringProfile(userBId),
      this.prisma.userLocation.findUnique({ where: { userId: userAId }, select: { latitude: true, longitude: true } }),
      this.prisma.userLocation.findUnique({ where: { userId: userBId }, select: { latitude: true, longitude: true } }),
    ]);

    if (!a || !b) return 0;

    return computeCompatibilityScore({
      ageA: calculateAge(a.dateOfBirth),
      ageB: calculateAge(b.dateOfBirth),
      goalA: a.relationshipGoal,
      goalB: b.relationshipGoal,
      interestSlugsA: a.interestLinks.map((l) => l.interest.slug),
      interestSlugsB: b.interestLinks.map((l) => l.interest.slug),
      languagesA: a.languages,
      languagesB: b.languages,
      distanceKm: locationA && locationB ? haversineKm(locationA, locationB) : null,
      maxDistanceKm: 100,
      lastActiveA: a.lastActiveAt,
      lastActiveB: b.lastActiveAt,
    }).score;
  }

  private loadScoringProfile(userId: string) {
    return this.prisma.profile.findUnique({
      where: { userId },
      select: {
        dateOfBirth: true,
        relationshipGoal: true,
        languages: true,
        lastActiveAt: true,
        interestLinks: { select: { interest: { select: { slug: true } } } },
      },
    });
  }

  private async findActiveMatch(a: string, b: string) {
    const [userAId, userBId] = [a, b].sort() as [string, string];
    return this.prisma.match.findUnique({
      where: { userAId_userBId: { userAId, userBId } },
      select: { id: true, compatibilityScore: true, state: true },
    });
  }

  private async assertWithinDailyLimit(userId: string, type: SwipeType): Promise<void> {
    const tier = await this.subscriptions.currentTier(userId);
    if (tier !== 'FREE') return;

    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);

    if (type === 'SUPER_LIKE') {
      const used = await this.prisma.swipe.count({
        where: { swiperId: userId, type: 'SUPER_LIKE', createdAt: { gte: since } },
      });
      if (used >= FREE_DAILY_SUPER_LIKES) {
        throw new HttpException('Daily Super Like limit reached. Upgrade to Premium.', HttpStatus.TOO_MANY_REQUESTS);
      }
      return;
    }

    const used = await this.prisma.swipe.count({
      where: { swiperId: userId, type: 'LIKE', createdAt: { gte: since } },
    });
    if (used >= FREE_DAILY_LIKES) {
      throw new HttpException(
        'Daily like limit reached. Upgrade to Premium for unlimited likes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async remainingLikes(userId: string): Promise<number | null> {
    const tier = await this.subscriptions.currentTier(userId);
    if (tier !== 'FREE') return null;

    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const used = await this.prisma.swipe.count({
      where: { swiperId: userId, type: 'LIKE', createdAt: { gte: since } },
    });
    return Math.max(0, FREE_DAILY_LIKES - used);
  }

  async swipeHistory(userId: string, limit = 50) {
    const rows = await this.prisma.swipe.findMany({
      where: { swiperId: userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      select: {
        id: true,
        type: true,
        createdAt: true,
        target: {
          select: {
            id: true,
            profile: {
              select: {
                displayName: true,
                photos: { orderBy: { position: 'asc' }, take: 1, select: { mediaId: true } },
              },
            },
          },
        },
      },
    });

    if (rows.length === 0) {
      throw new BadRequestException('No swipe history yet');
    }

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      swipedAt: row.createdAt,
      userId: row.target.id,
      displayName: row.target.profile?.displayName ?? 'Unknown',
      photoMediaId: row.target.profile?.photos[0]?.mediaId ?? null,
    }));
  }
}
