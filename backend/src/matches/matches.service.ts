import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { calculateAge } from '../common/utils/age.util';
import { haversineKm } from '../common/geo/geo.util';
import { buildApproximateLocationView } from '../common/geo/privacy.util';
import { UsersService } from '../users/users.service';

@Injectable()
export class MatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly users: UsersService,
  ) {}

  async list(userId: string) {
    const matches = await this.prisma.match.findMany({
      where: { state: 'ACTIVE', participants: { some: { userId } } },
      orderBy: { lastMessageAt: 'desc' },
      take: 200,
      select: {
        id: true,
        compatibilityScore: true,
        createdAt: true,
        lastMessageAt: true,
        conversation: { select: { id: true } },
        userAId: true,
        userBId: true,
        participants: { select: { userId: true } },
      },
    });

    const otherIds = matches
      .map((m) => (m.userAId === userId ? m.userBId : m.userAId))
      .filter((id): id is string => !!id);

    const profiles = await this.prisma.profile.findMany({
      where: { userId: { in: otherIds } },
      select: {
        userId: true,
        displayName: true,
        dateOfBirth: true,
        lastActiveAt: true,
        displayedAreaNode: { select: { name: true, kind: true } },
        photos: { orderBy: { position: 'asc' }, take: 1, select: { mediaId: true } },
        user: {
          select: { privacySettings: { select: { locationVisibility: true, shareAreaWithMatches: true } } },
        },
      },
    });
    const byUser = new Map(profiles.map((p) => [p.userId, p]));

    const viewerPrefs = await this.users.privacySettings(userId);

    return Promise.all(
      matches.map(async (match) => {
        const otherId = match.userAId === userId ? match.userBId : match.userAId;
        const profile = byUser.get(otherId);
        const privacy = profile?.user.privacySettings;

        // Distance between matched users, still only revealed when both opted in.
        const location = buildApproximateLocationView(
          {
            locationVisibility: privacy?.locationVisibility ?? 'APPROXIMATE_AREA',
            shareAreaWithMatches: privacy?.shareAreaWithMatches ?? false,
          },
          profile?.displayedAreaNode
            ? { name: profile.displayedAreaNode.name, kind: profile.displayedAreaNode.kind }
            : null,
          viewerPrefs.shareAreaWithMatches ? await this.matchDistance(userId, otherId) : null,
          { isMatch: true, isBlockedEitherWay: false },
        );

        const conversation = match.conversation;
        const unread = conversation ? await this.unreadCount(conversation.id, userId, otherId) : 0;

        return {
          matchId: match.id,
          conversationId: conversation?.id ?? null,
          compatibilityScore: match.compatibilityScore,
          matchedAt: match.createdAt,
          lastMessageAt: match.lastMessageAt,
          unreadMessages: unread,
          isOnline: await this.redis.isUserOnline(otherId),
          user: {
            userId: otherId,
            displayName: profile?.displayName ?? 'Unknown',
            age: profile ? calculateAge(profile.dateOfBirth) : null,
            photoMediaId: profile?.photos[0]?.mediaId ?? null,
            lastActiveAt: profile?.lastActiveAt ?? null,
            location,
          },
        };
      }),
    );
  }

  async get(userId: string, matchId: string) {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, state: 'ACTIVE', participants: { some: { userId } } },
      select: { id: true, compatibilityScore: true, createdAt: true, conversation: { select: { id: true } } },
    });
    if (!match) throw new NotFoundException('Match not found');
    return match;
  }

  async unmatch(userId: string, matchId: string): Promise<void> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, state: 'ACTIVE', participants: { some: { userId } } },
      select: { id: true },
    });
    if (!match) throw new NotFoundException('Match not found');

    await this.prisma.match.update({
      where: { id: match.id },
      data: { state: 'UNMATCHED', endedAt: new Date() },
    });
  }

  async markConversationRead(userId: string, conversationId: string): Promise<void> {
    await this.assertMember(conversationId, userId);
    await this.prisma.conversationReadState.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      create: { conversationId, userId, lastReadAt: new Date() },
      update: { lastReadAt: new Date() },
    });
  }

  async assertMember(conversationId: string, userId: string): Promise<void> {
    const membership = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { leftAt: true },
    });
    if (!membership || membership.leftAt) {
      throw new NotFoundException('Conversation not found');
    }
  }

  /** Messages from the other person that arrived after my last read receipt. */
  private async unreadCount(conversationId: string, userId: string, otherId: string): Promise<number> {
    const readState = await this.prisma.conversationReadState.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { lastReadAt: true },
    });

    return this.prisma.message.count({
      where: {
        conversationId,
        senderId: otherId,
        deletedAt: null,
        ...(readState ? { createdAt: { gt: readState.lastReadAt } } : {}),
      },
    });
  }

  private async matchDistance(userA: string, userB: string): Promise<number | null> {
    const [a, b] = await Promise.all([
      this.prisma.userLocation.findUnique({ where: { userId: userA }, select: { latitude: true, longitude: true } }),
      this.prisma.userLocation.findUnique({ where: { userId: userB }, select: { latitude: true, longitude: true } }),
    ]);
    if (!a || !b) return null;
    return haversineKm(a, b);
  }
}
