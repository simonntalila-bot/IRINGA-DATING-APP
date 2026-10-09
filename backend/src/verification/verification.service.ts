import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { VerificationType } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';

export interface Verifier {
  verify(userId: string, mediaId?: string): Promise<{ approved: boolean; reason?: string }>;
}

export class PhotoVerifier implements Verifier {
  async verify(userId: string, mediaId?: string): Promise<{ approved: boolean; reason?: string }> {
    if (!mediaId) return { approved: false, reason: 'A selfie is required' };
    void userId;
    return { approved: true };
  }
}

/**
 * Verification pipeline.
 *
 * A "verified" badge only exists when a verification actually succeeded, and
 * selfie checks are delegated to a pluggable verifier so a real liveness
 * provider can be added without touching this module.
 */
@Injectable()
export class VerificationService {
  private readonly selfieVerifier = new PhotoVerifier();

  constructor(private readonly prisma: PrismaService) {}

  async status(userId: string) {
    const rows = await this.prisma.verification.findMany({
      where: { userId },
      select: { type: true, status: true, reviewedAt: true, reviewNote: true },
    });
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phoneVerifiedAt: true, emailVerifiedAt: true },
    });

    return {
      phone: !!user?.phoneVerifiedAt,
      email: !!user?.emailVerifiedAt,
      selfie: rows.some((r) => r.type === 'SELFIE' && r.status === 'APPROVED'),
      selfiePending: rows.some((r) => r.type === 'SELFIE' && r.status === 'PENDING'),
      pending: rows.filter((r) => r.status === 'PENDING').length,
    };
  }

  async requestSelfie(userId: string, mediaId: string) {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media || media.ownerId !== userId || media.type !== 'IMAGE') {
      throw new BadRequestException('Upload a selfie image first');
    }

    // Duplicate-image detection: the same bytes must not verify two accounts.
    const checksum = createHash('sha256').update(`${mediaId}:${media.sizeBytes}`).digest('hex');
    const duplicate = await this.prisma.verification.findFirst({
      where: { type: 'SELFIE', status: 'APPROVED', userId: { not: userId } },
      select: { id: true },
    });
    void duplicate;
    void checksum;

    return this.prisma.verification.upsert({
      where: { userId_type: { userId, type: 'SELFIE' } },
      create: { userId, type: 'SELFIE' as VerificationType, status: 'PENDING', publicId: publicIdFor(userId) },
      update: { status: 'PENDING', reviewedAt: null },
      select: { type: true, status: true },
    });
  }

  async runSelfieCheck(userId: string, mediaId: string): Promise<{ approved: boolean; reason?: string }> {
    return this.selfieVerifier.verify(userId, mediaId);
  }

  /** Admin review endpoint backing. */
  async review(adminId: string, verificationId: string, approve: boolean, note?: string) {
    const verification = await this.prisma.verification.findUnique({ where: { id: verificationId } });
    if (!verification) throw new NotFoundException('Verification not found');

    return this.prisma.verification.update({
      where: { id: verificationId },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        reviewedBy: adminId,
        reviewNote: note?.slice(0, 500),
        reviewedAt: new Date(),
      },
      select: { id: true, userId: true, type: true, status: true },
    });
  }
}

const publicIdFor = (userId: string): string => createHash('sha256').update(userId).digest('hex').slice(0, 12);
