import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { StoryPrivacy } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

const STORY_TTL_HOURS = 24;

@Injectable()
export class StoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, input: { mediaId?: string; textBody?: string; privacy?: StoryPrivacy }) {
    if (!input.mediaId && !input.textBody) {
      throw new BadRequestException('A story needs a photo, a video or some text');
    }
    if (input.mediaId) {
      const media = await this.prisma.media.findUnique({ where: { id: input.mediaId } });
      if (!media || media.ownerId !== userId) throw new BadRequestException('Attach media that you uploaded');
    }

    return this.prisma.story.create({
      data: {
        userId,
        mediaId: input.mediaId,
        textBody: input.textBody?.slice(0, 500),
        privacy: input.privacy ?? 'PUBLIC',
        expiresAt: new Date(Date.now() + STORY_TTL_HOURS * 3600_000),
      },
      select: { id: true, expiresAt: true, privacy: true },
    });
  }

  /** Feed for a viewer: own stories + stories from matches (when privacy says so). */
  async feed(viewerId: string) {
    const now = new Date();
    const matches = await this.prisma.match.findMany({
      where: { state: 'ACTIVE', participants: { some: { userId: viewerId } } },
      select: { participants: { select: { userId: true } } },
    });
    const matchIds = new Set<string>([viewerId]);
    for (const match of matches) {
      for (const p of match.participants) matchIds.add(p.userId);
    }

    const stories = await this.prisma.story.findMany({
      where: {
        expiresAt: { gt: now },
        userId: { in: [...matchIds] },
        OR: [{ privacy: 'PUBLIC' }, { userId: viewerId }, { privacy: 'MATCHES_ONLY', user: { status: 'ACTIVE' } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        userId: true,
        mediaId: true,
        textBody: true,
        privacy: true,
        createdAt: true,
        expiresAt: true,
        views: { where: { viewerId }, select: { viewedAt: true } },
        user: {
          select: {
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

    return stories.map((story) => ({
      id: story.id,
      userId: story.userId,
      displayName: story.user.profile?.displayName ?? 'Unknown',
      avatarMediaId: story.user.profile?.photos[0]?.mediaId ?? null,
      mediaId: story.mediaId,
      textBody: story.textBody,
      privacy: story.privacy,
      isMine: story.userId === viewerId,
      seenByMe: story.views.length > 0,
      createdAt: story.createdAt,
      expiresAt: story.expiresAt,
    }));
  }

  async view(userId: string, storyId: string) {
    const story = await this.prisma.story.findFirst({ where: { id: storyId, expiresAt: { gt: new Date() } } });
    if (!story) throw new NotFoundException('Story expired');
    if (story.userId === userId) return { ok: true, alreadyViewed: true };

    await this.prisma.storyView.upsert({
      where: { storyId_viewerId: { storyId, viewerId: userId } },
      create: { storyId, viewerId: userId },
      update: {},
    });
    return { ok: true, alreadyViewed: false };
  }

  async viewers(userId: string, storyId: string) {
    const story = await this.prisma.story.findFirst({ where: { id: storyId, userId } });
    if (!story) throw new NotFoundException('Story not found');

    return this.prisma.storyView.findMany({
      where: { storyId },
      orderBy: { viewedAt: 'desc' },
      select: { viewedAt: true, viewer: { select: { profile: { select: { displayName: true } } } } },
    });
  }

  async hideStory(userId: string, targetId: string) {
    if (userId === targetId) throw new BadRequestException('You cannot hide your own story');
    await this.prisma.profileHide.upsert({
      where: { ownerId_targetId: { ownerId: userId, targetId } },
      create: { ownerId: userId, targetId },
      update: {},
    });
  }

  async delete(userId: string, storyId: string): Promise<void> {
    const story = await this.prisma.story.findFirst({ where: { id: storyId } });
    if (!story) throw new NotFoundException('Story not found');
    if (story.userId !== userId) throw new ForbiddenException('Not your story');
    await this.prisma.story.delete({ where: { id: storyId } });
  }

  /** Scheduled cleanup, also called on boot. */
  async purgeExpired(): Promise<number> {
    const result = await this.prisma.story.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    return result.count;
  }
}
