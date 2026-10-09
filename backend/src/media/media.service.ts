import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { MediaType } from '@prisma/client';
import { AppConfig } from '../common/config/app-config';
import { PrismaService } from '../common/prisma/prisma.service';
import { mediaPolicy, sniffBinaryHeader, extensionFor } from './media-policy';
import { StorageService } from './storage.service';

export interface UploadIntent {
  mediaId: string;
  storageKey: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresInSeconds: number;
  maxBytes: number;
  driver: 'r2' | 'local';
}

const MAX_DIMENSION = 12_000;
const MAX_DURATION_SECONDS: Record<MediaType, number> = { IMAGE: 0, VIDEO: 180, AUDIO: 300 };

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: AppConfig,
  ) {}

  async createUploadIntent(
    ownerId: string,
    input: { type: MediaType; mimeType: string; sizeBytes: number; durationSec?: number },
  ): Promise<UploadIntent> {
    const policy = mediaPolicy(input.type);

    if (!policy.allowedMimeTypes.includes(input.mimeType.toLowerCase())) {
      throw new BadRequestException(`Unsupported ${input.type.toLowerCase()} type: ${input.mimeType}`);
    }
    if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
      throw new BadRequestException('sizeBytes must be a positive number');
    }

    const maxBytes = Math.min(policy.maxBytes, this.limitFor(input.type));
    if (input.sizeBytes > maxBytes) {
      throw new BadRequestException(`File too large. Maximum is ${Math.round(maxBytes / 1024 / 1024)} MB`);
    }

    const duration = input.durationSec ?? 0;
    if (input.type !== 'IMAGE') {
      if (duration <= 0) throw new BadRequestException('durationSec is required for video and audio');
      if (duration > MAX_DURATION_SECONDS[input.type]) {
        throw new BadRequestException(`${input.type} must be ${MAX_DURATION_SECONDS[input.type]} seconds or shorter`);
      }
    }

    const media = await this.prisma.media.create({
      data: {
        ownerId,
        type: input.type,
        storageKey: 'pending',
        bucket: this.storage.driver === 'r2' ? this.config.r2Bucket : 'local',
        mimeType: input.mimeType.toLowerCase(),
        sizeBytes: input.sizeBytes,
        durationSec: input.type === 'IMAGE' ? null : duration,
        status: 'pending',
      },
    });

    const storageKey = `media/${ownerId}/${media.id}.${extensionFor(input.mimeType)}`;
    const upload = await this.storage.createUploadUrl(storageKey, input.mimeType);

    await this.prisma.media.update({ where: { id: media.id }, data: { storageKey } });

    return {
      mediaId: media.id,
      storageKey,
      uploadUrl: upload.uploadUrl,
      method: 'PUT',
      headers: upload.headers,
      expiresInSeconds: upload.expiresInSeconds,
      maxBytes,
      driver: upload.driver,
    };
  }

  /** Called by the client after a successful upload. */
  async completeUpload(
    ownerId: string,
    mediaId: string,
    meta: { width?: number; height?: number; durationSec?: number; sizeBytes?: number },
  ): Promise<{ mediaId: string; type: MediaType; ready: true }> {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) throw new NotFoundException('Upload not found');
    if (media.ownerId !== ownerId) throw new ForbiddenException('Not your upload');

    if (meta.width != null && (meta.width <= 0 || meta.width > MAX_DIMENSION)) {
      throw new BadRequestException('Invalid image width');
    }
    if (meta.height != null && (meta.height <= 0 || meta.height > MAX_DIMENSION)) {
      throw new BadRequestException('Invalid image height');
    }
    if (meta.durationSec != null && media.type !== 'IMAGE') {
      if (meta.durationSec <= 0 || meta.durationSec > MAX_DURATION_SECONDS[media.type]) {
        throw new BadRequestException('Invalid media duration');
      }
    }

    await this.prisma.media.update({
      where: { id: media.id },
      data: {
        status: 'ready',
        width: meta.width,
        height: meta.height,
        durationSec: media.type === 'IMAGE' ? null : (meta.durationSec ?? media.durationSec),
        sizeBytes: meta.sizeBytes ?? media.sizeBytes,
      },
    });

    return { mediaId: media.id, type: media.type, ready: true };
  }

  /** Stores bytes for the local development driver. */
  async putLocal(ownerId: string, storageKey: string, body: Buffer, declaredMimeType?: string): Promise<void> {
    const media = await this.prisma.media.findFirst({ where: { storageKey, ownerId } });
    if (!media) throw new NotFoundException('Upload not found');
    if (media.status !== 'pending') throw new BadRequestException('Upload already completed');

    if (body.byteLength > this.limitFor(media.type)) {
      throw new BadRequestException('File too large');
    }
    if (declaredMimeType && declaredMimeType !== media.mimeType) {
      throw new BadRequestException('Content-Type does not match the upload intent');
    }

    const policy = mediaPolicy(media.type);
    const sniff = sniffBinaryHeader(body, policy);
    if (!sniff.ok) throw new BadRequestException(sniff.reason);

    await this.storage.putLocalObject(storageKey, body);
    await this.prisma.media.update({
      where: { id: media.id },
      data: { sizeBytes: body.byteLength, status: 'uploaded' },
    });
  }

  async getSignedUrl(requestingUserId: string, mediaId: string): Promise<{ url: string; expiresInSeconds: number }> {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media || media.status === 'deleted') throw new NotFoundException('Media not found');

    await this.assertCanRead(requestingUserId, media);
    const url = await this.storage.createDownloadUrl(media.storageKey);
    return { url, expiresInSeconds: this.config.r2SignedUrlTtlSeconds };
  }

  /** Public assets: place photos only. Never user media. */
  async getPublicUrl(mediaId: string): Promise<string | null> {
    const media = await this.prisma.media.findUnique({
      where: { id: mediaId },
      include: { placePhotos: { take: 1 } },
    });
    if (!media || media.status === 'deleted') throw new NotFoundException('Media not found');
    if (media.placePhotos.length === 0) throw new NotFoundException('Media not found');

    return this.storage.publicUrlFor(media.storageKey) ?? this.storage.createDownloadUrl(media.storageKey);
  }

  private async assertCanRead(
    requestingUserId: string,
    media: { id: string; ownerId: string; type: MediaType },
  ): Promise<void> {
    if (media.ownerId === requestingUserId) return;

    // Chat attachments: only participants of a conversation containing it.
    const attachment = await this.prisma.messageAttachment.findFirst({
      where: { mediaId: media.id, message: { conversation: { members: { some: { userId: requestingUserId } } } } },
      select: { id: true },
    });
    if (attachment) return;

    // Profile media of an active match.
    if (media.type === 'IMAGE' || media.type === 'VIDEO') {
      const match = await this.prisma.match.findFirst({
        where: {
          state: 'ACTIVE',
          participants: { some: { userId: requestingUserId } },
          OR: [{ userAId: media.ownerId }, { userBId: media.ownerId }],
        },
        select: { id: true },
      });
      if (match) return;
    }

    throw new ForbiddenException('You do not have access to this media');
  }

  private limitFor(type: MediaType): number {
    switch (type) {
      case 'IMAGE':
        return this.config.maxImageBytes;
      case 'VIDEO':
        return this.config.maxVideoBytes;
      case 'AUDIO':
        return this.config.maxAudioBytes;
      default:
        return this.config.maxImageBytes;
    }
  }

  async deleteOwned(ownerId: string, mediaId: string): Promise<void> {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) return;
    if (media.ownerId !== ownerId) throw new ForbiddenException('Not your media');
    await this.prisma.media.update({ where: { id: mediaId }, data: { status: 'deleted' } });
  }

  async softDeleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.media.updateMany({ where: { id: { in: ids } }, data: { status: 'deleted' } });
  }
}
