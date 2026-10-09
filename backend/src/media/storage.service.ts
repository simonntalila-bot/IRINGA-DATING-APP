import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { PutObjectCommand, S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AppConfig } from '../common/config/app-config';

export interface PresignedUpload {
  driver: 'r2' | 'local';
  uploadUrl: string;
  method: 'PUT' | 'POST';
  headers: Record<string, string>;
  expiresInSeconds: number;
}

/**
 * Media storage abstraction.
 *
 * Cloudflare R2 (S3-compatible) is the production driver. When R2 credentials
 * are absent the service falls back to a local disk driver so the whole upload
 * flow still works in development. R2 credentials are read on the server only
 * and are never returned by any endpoint - the client only ever receives a
 * short-lived signed URL.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly r2: S3Client | null;

  constructor(private readonly config: AppConfig) {
    if (this.config.r2AccessKeyId && this.config.r2SecretAccessKey && this.config.r2Endpoint) {
      this.r2 = new S3Client({
        region: 'auto',
        endpoint: this.config.r2Endpoint,
        credentials: {
          accessKeyId: this.config.r2AccessKeyId as string,
          secretAccessKey: this.config.r2SecretAccessKey as string,
        },
      });
      this.logger.log(`Media storage driver: R2 (bucket ${this.config.r2Bucket})`);
    } else {
      this.r2 = null;
      this.logger.warn(
        `Media storage driver: local disk (${this.config.mediaLocalDir}). Configure R2_* for production.`,
      );
    }
  }

  get driver(): 'r2' | 'local' {
    return this.r2 ? 'r2' : 'local';
  }

  get localBaseDir(): string {
    return resolve(process.cwd(), this.config.mediaLocalDir);
  }

  async createUploadUrl(storageKey: string, mimeType: string): Promise<PresignedUpload> {
    if (this.r2) {
      const command = new PutObjectCommand({
        Bucket: this.config.r2Bucket,
        Key: storageKey,
        ContentType: mimeType,
      });
      const uploadUrl = await getSignedUrl(this.r2, command, { expiresIn: this.config.r2SignedUrlTtlSeconds });
      return {
        driver: 'r2',
        uploadUrl,
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        expiresInSeconds: this.config.r2SignedUrlTtlSeconds,
      };
    }

    return {
      driver: 'local',
      uploadUrl: `/api/v1/media/local-upload/${encodeURIComponent(storageKey)}`,
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      expiresInSeconds: this.config.r2SignedUrlTtlSeconds,
    };
  }

  async createDownloadUrl(storageKey: string): Promise<string> {
    if (this.r2) {
      const command = new GetObjectCommand({ Bucket: this.config.r2Bucket, Key: storageKey });
      return getSignedUrl(this.r2, command, { expiresIn: this.config.r2SignedUrlTtlSeconds });
    }

    const token = this.sign(storageKey);
    return `${this.config.appPublicUrl}/api/v1/media/local-file/${encodeURIComponent(storageKey)}?token=${token}`;
  }

  async putLocalObject(storageKey: string, body: Buffer): Promise<void> {
    const target = join(this.localBaseDir, storageKey);
    mkdirSync(dirname(target), { recursive: true });
    await writeFile(target, body);
  }

  readLocalObject(storageKey: string): Buffer {
    const target = join(this.localBaseDir, storageKey);
    try {
      return readFileSync(target);
    } catch {
      throw new NotFoundException('File not found');
    }
  }

  verifyLocalToken(storageKey: string, token: string): boolean {
    const expected = this.sign(storageKey);
    const a = Buffer.from(expected);
    const b = Buffer.from(token ?? '');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  private sign(value: string): string {
    return createHmac('sha256', this.config.jwtSecret)
      .update(`${value}:${this.config.r2SignedUrlTtlSeconds}`)
      .digest('hex')
      .slice(0, 32);
  }

  publicUrlFor(storageKey: string): string | null {
    if (!this.r2) return null;
    return this.config.r2PublicBaseUrl ? `${this.config.r2PublicBaseUrl.replace(/\/$/, '')}/${storageKey}` : null;
  }
}
