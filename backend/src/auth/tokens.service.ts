import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import { AppConfig } from '../common/config/app-config';
import { PrismaService } from '../common/prisma/prisma.service';
import { nowPlusDays, randomToken } from '../common/utils/random.util';

export interface AccessTokenPayload {
  sub: string;
  isAdmin: boolean;
  status: string;
  adminRole?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  refreshExpiresAt: string;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

@Injectable()
export class TokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  async issueTokens(
    user: { id: string; status: string; isAdmin: boolean },
    ctx: { userAgent?: string; ip?: string; deviceId?: string; deviceName?: string; familyId?: string } = {},
  ): Promise<TokenPair> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      isAdmin: user.isAdmin,
      status: user.status,
    };

    const expiresInSeconds = this.parseTtl(this.config.jwtAccessTtl);

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.jwtSecret,
      expiresIn: expiresInSeconds,
    });

    const refreshToken = randomToken(48);
    const expiresAt = nowPlusDays(this.config.jwtRefreshTtlDays);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        familyId: ctx.familyId ?? randomUUID(),
        userAgent: ctx.userAgent?.slice(0, 400),
        ip: ctx.ip,
        expiresAt,
      },
    });

    if (ctx.deviceId || ctx.deviceName) {
      await this.prisma.deviceSession.create({
        data: {
          userId: user.id,
          deviceId: ctx.deviceId,
          deviceName: ctx.deviceName,
          ip: ctx.ip,
          userAgent: ctx.userAgent?.slice(0, 400),
        },
      });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    });

    return {
      accessToken,
      refreshToken,
      expiresInSeconds,
      refreshExpiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Rotating refresh. Presenting an already-rotated token means it leaked:
   * the whole family is revoked immediately.
   */
  async rotate(refreshToken: string, ctx: { userAgent?: string; ip?: string } = {}): Promise<TokenPair> {
    const tokenHash = sha256(refreshToken);
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!record) throw new UnauthorizedException('Invalid refresh token');

    if (record.revokedAt || record.rotatedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: record.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reuse detected - all sessions revoked');
    }

    if (record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = await this.prisma.user.findUnique({ where: { id: record.userId } });
    if (!user || user.deletedAt || user.status === 'BANNED') {
      throw new UnauthorizedException('Account is not active');
    }

    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { rotatedAt: new Date(), revokedAt: new Date() },
    });

    return this.issueTokens(
      { id: user.id, status: user.status, isAdmin: user.isAdmin },
      { ...ctx, familyId: record.familyId },
    );
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.prisma.deviceSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private parseTtl(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) return 900;
    const value = Number(match[1]);
    const unit = match[2] as 's' | 'm' | 'h' | 'd';
    const factor = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
    return value * factor;
  }
}
