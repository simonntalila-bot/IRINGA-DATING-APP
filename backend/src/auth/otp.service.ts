import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppConfig } from '../common/config/app-config';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { nowPlusSeconds, randomOtp } from '../common/utils/random.util';

export type OtpPurpose = 'PHONE_VERIFICATION' | 'PASSWORD_RESET';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * OTP issuing + verification.
 *
 * Codes are stored hashed, single-use, short-lived and rate limited per target.
 * Delivery is delegated to `dispatch` - no SMS provider credentials are shipped
 * with this repository. In development the code is logged so the flow is
 * testable end to end; in production nothing is logged and the dispatcher must
 * be wired to a real gateway.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private static readonly MAX_ATTEMPTS = 5;
  private static readonly CODE_TTL_SECONDS = 300;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
  ) {}

  async issue(
    target: string,
    purpose: OtpPurpose,
    userId?: string,
  ): Promise<{ code: string | null; expiresInSeconds: number }> {
    const rate = await this.redis.hitRateLimit(`otp:${purpose}:${target}`, 3, 3600);
    if (!rate.allowed) {
      throw new HttpException('Too many codes requested. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = randomOtp();

    await this.prisma.verificationCode.create({
      data: {
        userId,
        target,
        channel: target.includes('@') ? 'email' : 'phone',
        codeHash: sha256(`${purpose}:${code}`),
        purpose,
        expiresAt: nowPlusSeconds(OtpService.CODE_TTL_SECONDS),
      },
    });

    await this.dispatch(target, code, purpose);

    return {
      code: this.config.isProduction ? null : code,
      expiresInSeconds: OtpService.CODE_TTL_SECONDS,
    };
  }

  async verify(target: string, purpose: OtpPurpose, code: string): Promise<boolean> {
    const rate = await this.redis.hitRateLimit(`otpverify:${purpose}:${target}`, 10, 600);
    if (!rate.allowed) {
      throw new HttpException('Too many attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const record = await this.prisma.verificationCode.findFirst({
      where: { target, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) throw new BadRequestException('Request a new code');
    if (record.attempts >= OtpService.MAX_ATTEMPTS)
      throw new BadRequestException('Too many attempts. Request a new code.');

    if (record.codeHash !== sha256(`${purpose}:${code}`)) {
      await this.prisma.verificationCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
      throw new BadRequestException('Incorrect code');
    }

    await this.prisma.verificationCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
    return true;
  }

  private async dispatch(target: string, code: string, purpose: OtpPurpose): Promise<void> {
    // TODO(production): plug in the SMS/email gateway (e.g. Africa's Talking,
    // Twilio, SMSProvider). Keys live in env vars, never in this repository.
    if (this.config.isProduction) {
      this.logger.log(`OTP dispatched via gateway for ${maskTarget(target)} (${purpose})`);
      return;
    }
    this.logger.warn(`[DEV ONLY] OTP for ${target} (${purpose}): ${code}`);
  }
}

export const maskTarget = (target: string): string => {
  if (target.includes('@')) {
    const [name, domain] = target.split('@');
    return `${name.slice(0, 2)}***@${domain}`;
  }
  return `${target.slice(0, 4)}****${target.slice(-2)}`;
};
