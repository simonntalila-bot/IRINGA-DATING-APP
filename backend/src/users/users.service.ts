import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { LocationVisibility } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { assertNotBlocked, buildBlockMap, isBlockedEitherWay, type BlockMap } from '../common/utils/block.util';

export interface PrivacySettings {
  locationVisibility: LocationVisibility;
  shareAreaWithMatches: boolean;
  allowAreaActivityAlerts: boolean;
  allowPlaceAlerts: boolean;
  discoveryRadiusKm: number;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async blockMap(userId: string): Promise<BlockMap> {
    const [blockedByViewer, blockedViewer, hidden] = await Promise.all([
      this.prisma.block.findMany({ where: { blockerId: userId }, select: { blockedId: true } }),
      this.prisma.block.findMany({ where: { blockedId: userId }, select: { blockerId: true } }),
      this.prisma.profileHide.findMany({ where: { ownerId: userId }, select: { targetId: true } }),
    ]);
    return buildBlockMap({ blockedByViewer, blockedViewer, hidden });
  }

  async isBlockedEitherWay(userA: string, userB: string): Promise<boolean> {
    const count = await this.prisma.block.count({
      where: {
        OR: [
          { blockerId: userA, blockedId: userB },
          { blockerId: userB, blockedId: userA },
        ],
      },
    });
    return count > 0;
  }

  /** Blocks, self-targeting and suspended accounts all stop here. */
  async assertCanInteract(viewerId: string, targetId: string): Promise<void> {
    if (viewerId === targetId) throw new BadRequestException('You cannot do that on your own profile');

    const map = await this.blockMap(viewerId);
    assertNotBlocked(map, targetId);

    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { status: true, deletedAt: true },
    });
    if (!target || target.deletedAt || target.status === 'BANNED' || target.status === 'SUSPENDED') {
      throw new NotFoundException('Profile not found');
    }
  }

  async privacySettings(userId: string): Promise<PrivacySettings> {
    const pref = await this.prisma.userPrivacySettings.findUnique({ where: { userId } });
    if (!pref) {
      const created = await this.prisma.userPrivacySettings.create({ data: { userId } });
      return {
        locationVisibility: created.locationVisibility,
        shareAreaWithMatches: created.shareAreaWithMatches,
        allowAreaActivityAlerts: created.allowAreaActivityAlerts,
        allowPlaceAlerts: created.allowPlaceAlerts,
        discoveryRadiusKm: created.discoveryRadiusKm,
      };
    }
    return {
      locationVisibility: pref.locationVisibility,
      shareAreaWithMatches: pref.shareAreaWithMatches,
      allowAreaActivityAlerts: pref.allowAreaActivityAlerts,
      allowPlaceAlerts: pref.allowPlaceAlerts,
      discoveryRadiusKm: pref.discoveryRadiusKm,
    };
  }

  async updatePrivacySettings(userId: string, input: Partial<PrivacySettings>): Promise<PrivacySettings> {
    if (input.discoveryRadiusKm != null) {
      if (input.discoveryRadiusKm < 1 || input.discoveryRadiusKm > 200) {
        throw new BadRequestException('discoveryRadiusKm must be between 1 and 200');
      }
    }
    // Sharing with matches requires the visibility to not be HIDDEN, otherwise
    // the setting would be contradictory and could leak through other paths.
    if (input.shareAreaWithMatches === true && input.locationVisibility === 'HIDDEN') {
      throw new BadRequestException('Enable area visibility before sharing your area with matches');
    }

    const updated = await this.prisma.userPrivacySettings.upsert({
      where: { userId },
      create: { userId, ...input },
      update: input,
    });

    return {
      locationVisibility: updated.locationVisibility,
      shareAreaWithMatches: updated.shareAreaWithMatches,
      allowAreaActivityAlerts: updated.allowAreaActivityAlerts,
      allowPlaceAlerts: updated.allowPlaceAlerts,
      discoveryRadiusKm: updated.discoveryRadiusKm,
    };
  }

  async blockUser(userId: string, targetId: string, reason?: string): Promise<void> {
    if (userId === targetId) throw new BadRequestException('You cannot block yourself');

    await this.prisma.$transaction(async (tx) => {
      await tx.block.upsert({
        where: { blockerId_blockedId: { blockerId: userId, blockedId: targetId } },
        create: { blockerId: userId, blockedId: targetId, reason },
        update: {},
      });

      // Blocking ends any active match and conversation.
      const match = await tx.match.findFirst({
        where: {
          state: 'ACTIVE',
          participants: { some: { userId } },
          OR: [{ userAId: targetId }, { userBId: targetId }],
        },
        select: { id: true },
      });
      if (match) {
        await tx.match.update({
          where: { id: match.id },
          data: { state: 'UNMATCHED', endedAt: new Date() },
        });
      }
    });
  }

  async unblockUser(userId: string, targetId: string): Promise<void> {
    await this.prisma.block.deleteMany({ where: { blockerId: userId, blockedId: targetId } });
  }

  async listBlocked(userId: string) {
    const blocks = await this.prisma.block.findMany({
      where: { blockerId: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        reason: true,
        blocked: {
          select: {
            id: true,
            profile: { select: { displayName: true, photos: { take: 1, select: { mediaId: true } } } },
          },
        },
      },
    });

    return blocks.map((b) => ({
      id: b.id,
      blockedAt: b.createdAt,
      reason: b.reason,
      user: {
        id: b.blocked.id,
        displayName: b.blocked.profile?.displayName ?? 'Unknown',
        photoMediaId: b.blocked.profile?.photos[0]?.mediaId ?? null,
      },
    }));
  }

  async hideProfile(userId: string, targetId: string): Promise<void> {
    if (userId === targetId) throw new BadRequestException('You cannot hide yourself');
    await this.prisma.profileHide.upsert({
      where: { ownerId_targetId: { ownerId: userId, targetId } },
      create: { ownerId: userId, targetId },
      update: {},
    });
  }

  async unhideProfile(userId: string, targetId: string): Promise<void> {
    await this.prisma.profileHide.deleteMany({ where: { ownerId: userId, targetId } });
  }

  async assertNotDeleted(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { deletedAt: true } });
    if (!user || user.deletedAt) throw new ForbiddenException('Account is not active');
  }

  async touchActive(userId: string): Promise<void> {
    await Promise.all([
      this.prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } }),
      this.prisma.profile.updateMany({ where: { userId }, data: { lastActiveAt: new Date() } }),
    ]);
  }
}

export type { BlockMap };
export const blockedBetween = isBlockedEitherWay;
