import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, input: { caption?: string; mediaIds: string[] }) {
    if (!input.mediaIds.length) throw new BadRequestException('A post needs at least one photo or video');

    const owned = await this.prisma.media.count({
      where: { id: { in: input.mediaIds }, ownerId: userId, status: { not: 'deleted' } },
    });
    if (owned !== input.mediaIds.length) throw new BadRequestException('All media must be yours');

    return this.prisma.post.create({
      data: {
        userId,
        caption: input.caption?.slice(0, 1000),
        media: { create: input.mediaIds.map((mediaId, position) => ({ mediaId, position })) },
      },
      select: { id: true, createdAt: true },
    });
  }

  async feed(userId: string, cursor?: string, limit = 20) {
    const map = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    const blocked = new Set<string>(map.flatMap((b) => [b.blockerId, b.blockedId]));
    blocked.add(userId);

    const posts = await this.prisma.post.findMany({
      where: { deletedAt: null, userId: { notIn: [...blocked] } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 50),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        media: { orderBy: { position: 'asc' }, select: { mediaId: true, position: true } },
        _count: { select: { likes: true, comments: true } },
        user: {
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

    return posts.map((post) => ({
      id: post.id,
      caption: post.caption,
      createdAt: post.createdAt,
      mediaIds: post.media.map((m) => m.mediaId),
      likeCount: post._count.likes,
      commentCount: post._count.comments,
      author: {
        userId: post.user.id,
        displayName: post.user.profile?.displayName ?? 'Unknown',
        photoMediaId: post.user.profile?.photos[0]?.mediaId ?? null,
      },
    }));
  }

  async like(userId: string, postId: string): Promise<{ liked: boolean }> {
    const post = await this.prisma.post.findFirst({ where: { id: postId, deletedAt: null }, select: { id: true } });
    if (!post) throw new NotFoundException('Post not found');

    await this.prisma.postLike.upsert({
      where: { postId_userId: { postId, userId } },
      create: { postId, userId },
      update: {},
    });
    return { liked: true };
  }

  async unlike(userId: string, postId: string): Promise<{ liked: boolean }> {
    await this.prisma.postLike.deleteMany({ where: { postId, userId } });
    return { liked: false };
  }

  async comment(userId: string, postId: string, body: string) {
    const post = await this.prisma.post.findFirst({ where: { id: postId, deletedAt: null }, select: { id: true } });
    if (!post) throw new NotFoundException('Post not found');

    return this.prisma.postComment.create({
      data: { postId, userId, body: body.slice(0, 500) },
      select: { id: true, body: true, createdAt: true },
    });
  }

  async remove(userId: string, postId: string): Promise<void> {
    const post = await this.prisma.post.findFirst({ where: { id: postId }, select: { userId: true } });
    if (!post) throw new NotFoundException('Post not found');
    if (post.userId !== userId) throw new ForbiddenException('Not your post');
    await this.prisma.post.update({ where: { id: postId }, data: { deletedAt: new Date() } });
  }
}
