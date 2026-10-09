import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentType, ProductType, VideoStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppConfig } from '../common/config/app-config';
import { EntitlementService } from '../entitlements/entitlement.service';
import { PaymentsService, type PaymentReceipt } from '../payments/payments.service';
import { StorageService } from '../media/storage.service';

export const PREMIUM_VIDEO_PRICE_MINOR = 100_000;
export const CURRENCY = 'TZS';

@Injectable()
export class VideosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly entitlements: EntitlementService,
    private readonly payments: PaymentsService,
    private readonly config: AppConfig,
  ) {}

  async categories() {
    return this.prisma.videoCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, slug: true, labelEn: true, labelSw: true, emoji: true },
    });
  }

  /**
   * Catalog. Free videos play immediately; premium ones show a price and never a
   * storage key. `owned` is per viewer.
   */
  async catalog(viewerId: string, opts: { categorySlug?: string; search?: string; limit?: number } = {}) {
    const videos = await this.prisma.premiumVideo.findMany({
      where: {
        status: VideoStatus.PUBLISHED,
        ...(opts.categorySlug ? { category: { slug: opts.categorySlug as never } } : {}),
        ...(opts.search ? { title: { contains: opts.search, mode: 'insensitive' } } : {}),
      },
      orderBy: { publishedAt: 'desc' },
      take: Math.min(opts.limit ?? 60, 200),
      include: {
        category: { select: { slug: true, labelEn: true, labelSw: true, emoji: true } },
      },
    });

    const purchased = await this.prisma.videoPurchase.findMany({
      where: { userId: viewerId, status: 'ACTIVE', videoId: { in: videos.map((v) => v.id) } },
      select: { videoId: true },
    });
    const owned = new Set(purchased.map((p) => p.videoId));

    const withThumbs = await Promise.all(
      videos.map(async (video) => ({
        id: video.id,
        title: video.title,
        description: video.description,
        category: video.category,
        durationSec: video.durationSec,
        isPremium: video.isPremium,
        priceMinor: video.isPremium ? video.priceMinor : 0,
        currency: video.currency,
        owned: owned.has(video.id),
        /** Short-lived signed thumbnail URL - never the raw R2 key. */
        thumbnailUrl: video.thumbnailKey ? await this.storage.createDownloadUrl(video.thumbnailKey) : null,
      })),
    );

    return withThumbs;
  }

  /**
   * Playback. Returns a signed URL only when the viewer owns the video (or it is
   * free). A premium video without an entitlement gets 403, never a URL.
   */
  async playbackUrl(
    viewerId: string,
    videoId: string,
  ): Promise<{ url: string; expiresInSeconds: number; owned: boolean }> {
    const video = await this.prisma.premiumVideo.findUnique({
      where: { id: videoId },
      select: { id: true, title: true, videoKey: true, isPremium: true, status: true },
    });
    if (!video || video.status !== VideoStatus.PUBLISHED) throw new NotFoundException('Video not found');

    const allowed = await this.entitlements.canViewPremiumVideo(viewerId, videoId);
    if (!allowed) {
      throw new ForbiddenException({
        message: 'Purchase this video to watch it',
        code: 'VIDEO_NOT_OWNED',
        priceMinor: PREMIUM_VIDEO_PRICE_MINOR,
        currency: CURRENCY,
      });
    }

    await this.prisma.sensitiveAccessLog.create({
      data: {
        actorId: viewerId,
        actorRole: 'user',
        subjectId: videoId,
        action: 'video.play',
        reason: allowed ? 'entitled' : 'denied',
      },
    });

    const url = await this.storage.createDownloadUrl(video.videoKey);
    return { url, expiresInSeconds: this.config.r2SignedUrlTtlSeconds, owned: true };
  }

  /** Rule 7: an already purchased video is never charged again. */
  async purchase(viewerId: string, videoId: string, idempotencyKey: string): Promise<PaymentReceipt> {
    const video = await this.prisma.premiumVideo.findUnique({
      where: { id: videoId },
      select: { id: true, title: true, priceMinor: true, currency: true, isPremium: true, status: true },
    });
    if (!video || video.status !== VideoStatus.PUBLISHED) throw new NotFoundException('Video not found');
    if (!video.isPremium) throw new BadRequestException('This video is free');

    const { alreadyOwned } = await this.payments.existingItem(viewerId, ProductType.PREMIUM_VIDEO, videoId);
    if (alreadyOwned) {
      throw new BadRequestException({ message: 'You already own this video', code: 'ALREADY_OWNED' });
    }

    return this.payments.createPayment({
      userId: viewerId,
      type: PaymentType.VIDEO_PURCHASE,
      items: [
        {
          productType: ProductType.PREMIUM_VIDEO,
          productId: videoId,
          amountMinor: video.priceMinor || PREMIUM_VIDEO_PRICE_MINOR,
        },
      ],
      idempotencyKey,
      metadata: { videoId, title: video.title },
    });
  }

  // --- Admin management (spec section 25) -------------------------------

  /** Every video regardless of status, for the admin table. */
  async adminList() {
    const videos = await this.prisma.premiumVideo.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        title: true,
        status: true,
        isPremium: true,
        priceMinor: true,
        currency: true,
        durationSec: true,
        publishedAt: true,
        category: { select: { slug: true, labelEn: true } },
        _count: { select: { purchases: true } },
      },
    });
    return videos;
  }

  async adminCreate(input: {
    title: string;
    description?: string;
    categorySlug: string;
    videoKey: string;
    thumbnailKey?: string;
    durationSec?: number;
    sizeBytes?: number;
    mimeType?: string;
    priceMinor?: number;
    isPremium?: boolean;
    publish?: boolean;
  }) {
    const category = await this.prisma.videoCategory.findUnique({ where: { slug: input.categorySlug } });
    if (!category) throw new NotFoundException('Video category not found');

    return this.prisma.premiumVideo.create({
      data: {
        title: input.title.trim(),
        description: input.description,
        categoryId: category.id,
        videoKey: input.videoKey,
        thumbnailKey: input.thumbnailKey,
        bucket: this.storage.driver === 'r2' ? this.config.r2Bucket : 'local',
        durationSec: input.durationSec,
        sizeBytes: input.sizeBytes,
        mimeType: input.mimeType ?? 'video/mp4',
        priceMinor: input.priceMinor ?? PREMIUM_VIDEO_PRICE_MINOR,
        currency: CURRENCY,
        isPremium: input.isPremium ?? true,
        status: input.publish ? VideoStatus.PUBLISHED : VideoStatus.DRAFT,
        publishedAt: input.publish ? new Date() : null,
      },
      select: { id: true, title: true, status: true, priceMinor: true },
    });
  }

  async adminUpdate(
    videoId: string,
    patch: Partial<{
      title: string;
      description: string;
      categorySlug: string;
      priceMinor: number;
      isPremium: boolean;
      status: VideoStatus;
      moderationNote: string;
    }>,
  ) {
    let categoryId: string | undefined;
    if (patch.categorySlug) {
      const category = await this.prisma.videoCategory.findUnique({ where: { slug: patch.categorySlug } });
      if (!category) throw new NotFoundException('Video category not found');
      categoryId = category.id;
    }

    return this.prisma.premiumVideo.update({
      where: { id: videoId },
      data: {
        ...(patch.title ? { title: patch.title.trim() } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(patch.priceMinor !== undefined ? { priceMinor: patch.priceMinor } : {}),
        ...(patch.isPremium !== undefined ? { isPremium: patch.isPremium } : {}),
        ...(patch.status
          ? {
              status: patch.status,
              publishedAt: patch.status === VideoStatus.PUBLISHED ? new Date() : undefined,
            }
          : {}),
        ...(patch.moderationNote !== undefined ? { moderationNote: patch.moderationNote } : {}),
      },
      select: { id: true, title: true, status: true, isPremium: true, priceMinor: true },
    });
  }

  async adminDelete(videoId: string): Promise<void> {
    // Soft: purchases stay intact and can be refunded per business rules.
    await this.prisma.premiumVideo.update({
      where: { id: videoId },
      data: { status: VideoStatus.UNPUBLISHED },
    });
  }

  async adminStats() {
    const [total, published, premium, purchases, revenue] = await Promise.all([
      this.prisma.premiumVideo.count(),
      this.prisma.premiumVideo.count({ where: { status: VideoStatus.PUBLISHED } }),
      this.prisma.premiumVideo.count({ where: { isPremium: true, status: VideoStatus.PUBLISHED } }),
      this.prisma.videoPurchase.count({ where: { status: 'ACTIVE' } }),
      this.prisma.videoPurchase.aggregate({ _sum: { amountMinor: true }, where: { status: 'ACTIVE' } }),
    ]);
    return { total, published, premium, purchases, revenueMinor: revenue._sum.amountMinor ?? 0, currency: CURRENCY };
  }

  /** Moderation-driven takedown. */
  async ban(videoId: string, note: string): Promise<void> {
    await this.prisma.premiumVideo.update({
      where: { id: videoId },
      data: { status: VideoStatus.BANNED, moderationNote: note },
    });
  }
}
