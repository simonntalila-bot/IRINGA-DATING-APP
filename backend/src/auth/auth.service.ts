import { BadRequestException, ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UserStatus } from '@prisma/client';
import { AppConfig } from '../common/config/app-config';
import { EncryptionService, normalisePhone } from '../common/crypto/encryption.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { isAtLeast18, isValidDateOfBirth } from '../common/utils/age.util';
import { publicHandle } from '../common/utils/random.util';
import { OtpService } from './otp.service';
import { TokensService, type TokenPair } from './tokens.service';
import type { LoginDto, RegisterDto } from './dto/auth.dto';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly otp: OtpService,
    private readonly encryption: EncryptionService,
    private readonly config: AppConfig,
  ) {}

  /**
   * Registration is Iringa-scoped by DESIGN but not GPS-gated: a bad GPS fix
   * must never lock someone out of creating an account. Location is detected
   * and validated separately in the locations module.
   *
   * The phone number is stored encrypted with a keyed HMAC index for lookups,
   * so the database never holds a readable contact number.
   */
  async register(
    dto: RegisterDto,
    ctx: RequestContext,
  ): Promise<{ userId: string; otp: { expiresInSeconds: number; devCode: string | null } }> {
    if (!dto.confirm18Plus) {
      throw new BadRequestException('You must confirm you are 18 or older');
    }

    const dateOfBirth = new Date(`${dto.dateOfBirth}T00:00:00.000Z`);
    if (!isValidDateOfBirth(dateOfBirth)) throw new BadRequestException('Invalid date of birth');
    if (!isAtLeast18(dateOfBirth)) {
      throw new BadRequestException('You must be 18 or older to use this app');
    }

    const phone = normalisePhone(dto.phone);
    const phoneHash = this.encryption.hash(phone);
    const email = dto.email?.toLowerCase();

    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ phoneHash }, ...(email ? [{ email }] : [])] },
      select: { id: true, phoneHash: true, email: true },
    });

    if (existing) {
      throw new ConflictException(
        existing.email === email
          ? 'An account with this email already exists'
          : 'An account with this phone number already exists',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          phoneHash,
          phoneEncrypted: this.encryption.encrypt(phone),
          email,
          passwordHash,
          status: UserStatus.PENDING_VERIFICATION,
          ageConfirmedAt: new Date(),
        },
      });

      await tx.profile.create({
        data: {
          userId: created.id,
          displayName: dto.displayName.trim(),
          dateOfBirth,
          gender: dto.gender,
          interestedIn: [],
          relationshipGoal: dto.relationshipGoal,
        },
      });

      await tx.userPrivacySettings.create({ data: { userId: created.id } });

      // Discovery preference starts from the viewer's own gender (male ->
      // female, female -> male) but is stored as data, never hard-coded.
      const preferredGender =
        dto.gender === 'MALE'
          ? ['FEMALE' as const]
          : dto.gender === 'FEMALE'
            ? ['MALE' as const]
            : ['FEMALE' as const, 'MALE' as const];

      await tx.discoveryPreference.create({ data: { userId: created.id, preferredGender } });

      // Public share handle (used by /p/:handle deep links) - never the uuid.
      await tx.verification.create({
        data: {
          userId: created.id,
          type: 'PHONE',
          status: 'PENDING',
          publicId: publicHandle(),
        },
      });

      return created;
    });

    const issued = await this.otp.issue(phone, 'PHONE_VERIFICATION', user.id);

    this.logger.log(`Registered user ${user.id} (phone verification pending) from ${ctx.ip ?? 'unknown ip'}`);

    return {
      userId: user.id,
      otp: { expiresInSeconds: issued.expiresInSeconds, devCode: issued.code },
    };
  }

  async verifyPhone(target: string, code: string, ctx: RequestContext): Promise<TokenPair> {
    await this.otp.verify(normalisePhone(target), 'PHONE_VERIFICATION', code);

    const user = await this.prisma.user.findUnique({
      where: { phoneHash: this.encryption.hash(normalisePhone(target)) },
    });
    if (!user) throw new BadRequestException('Account not found');

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        phoneVerifiedAt: new Date(),
        status: user.status === UserStatus.PENDING_VERIFICATION ? UserStatus.ACTIVE : user.status,
      },
    });

    return this.tokens.issueTokens({ id: user.id, status: UserStatus.ACTIVE, isAdmin: user.isAdmin }, ctx);
  }

  async login(dto: LoginDto, ctx: RequestContext): Promise<TokenPair> {
    const phone = normalisePhone(dto.phone);
    const user = await this.prisma.user.findUnique({ where: { phoneHash: this.encryption.hash(phone) } });

    // Constant-ish work whether or not the account exists.
    const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const ok = await bcrypt.compare(dto.password, hash);

    if (!user || !ok) throw new UnauthorizedException('Incorrect phone number or password');
    if (user.deletedAt) throw new UnauthorizedException('Account is not active');
    if (user.status === UserStatus.BANNED) throw new UnauthorizedException('This account has been suspended');
    if (user.status === UserStatus.SUSPENDED) throw new UnauthorizedException('This account is suspended');

    if (!user.phoneVerifiedAt) {
      const issued = await this.otp.issue(phone, 'PHONE_VERIFICATION', user.id);
      throw new UnauthorizedException({
        message: 'Phone number not verified',
        code: 'PHONE_NOT_VERIFIED',
        devCode: this.config.isProduction ? undefined : issued.code,
      });
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });

    return this.tokens.issueTokens({ id: user.id, status: user.status, isAdmin: user.isAdmin }, ctx);
  }

  async requestOtp(target: string, purpose: 'PHONE_VERIFICATION' | 'PASSWORD_RESET') {
    const isEmail = target.includes('@');
    const normalised = isEmail ? target.toLowerCase() : normalisePhone(target);
    const existing = await this.prisma.user.findFirst({
      where: isEmail ? { email: normalised } : { phoneHash: this.encryption.hash(normalised) },
      select: { id: true },
    });

    if (!existing) {
      // Do not leak account existence.
      this.logger.warn(`OTP requested for unknown target (${purpose})`);
      return { expiresInSeconds: 300, devCode: null };
    }

    const issued = await this.otp.issue(normalised, purpose, existing.id);
    return { expiresInSeconds: issued.expiresInSeconds, devCode: issued.code };
  }

  /** Password reset consumes the OTP, rotates the password and revokes sessions. */
  async resetPasswordWithCode(phone: string, code: string, newPassword: string): Promise<void> {
    const normalised = normalisePhone(phone);
    await this.otp.verify(normalised, 'PASSWORD_RESET', code);

    const user = await this.prisma.user.findUnique({ where: { phoneHash: this.encryption.hash(normalised) } });
    if (!user) throw new BadRequestException('Account not found');

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await this.tokens.revokeAllForUser(user.id);
  }

  async rotate(refreshToken: string, ctx: RequestContext): Promise<TokenPair> {
    return this.tokens.rotate(refreshToken, ctx);
  }

  async logout(refreshToken: string | undefined, allDevices: boolean, userId: string): Promise<void> {
    if (refreshToken) await this.tokens.revoke(refreshToken);
    if (allDevices) await this.tokens.revokeAllForUser(userId);
  }

  /** Change password while signed in. */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user) throw new UnauthorizedException('Account not found');

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new BadRequestException('Current password is incorrect');

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.tokens.revokeAllForUser(userId);
  }

  async loginHistory(userId: string) {
    return this.prisma.deviceSession.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
      take: 50,
      select: { id: true, deviceName: true, platform: true, ip: true, lastSeenAt: true, createdAt: true },
    });
  }

  async revokeDevice(userId: string, sessionId: string): Promise<void> {
    await this.prisma.deviceSession.updateMany({
      where: { id: sessionId, userId },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Delete account. Unlocks and purchases are anonymised rather than deleted so
   * the other party is not left with a dangling reference, then everything
   * personal is removed.
   */
  async deleteAccount(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.contactUnlock.updateMany({ where: { buyerId: userId }, data: { profileOwnerId: userId } as never });
      await tx.message.updateMany({ where: { senderId: userId }, data: { body: null, deletedAt: new Date() } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.story.deleteMany({ where: { userId } });
      await tx.post.updateMany({ where: { userId }, data: { deletedAt: new Date() } });
      await tx.media.updateMany({ where: { ownerId: userId }, data: { status: 'deleted' } });
      await tx.user.update({
        where: { id: userId },
        data: { deletedAt: new Date(), status: UserStatus.DELETED },
      });
    });

    await this.tokens.revokeAllForUser(userId);
  }

  /** Personal data export (GDPR-style) - what we hold about this account. */
  async exportMyData(userId: string) {
    const [user, profile, photos, unlocks, purchases, payments, location] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          status: true,
          createdAt: true,
          phoneVerifiedAt: true,
          // Deliberately excludes the encrypted phone and WhatsApp values.
        },
      }),
      this.prisma.profile.findUnique({ where: { userId } }),
      this.prisma.profilePhoto.findMany({ where: { userId }, select: { mediaId: true, position: true } }),
      this.prisma.contactUnlock.findMany({
        where: { buyerId: userId },
        select: { createdAt: true, amountMinor: true, currency: true, status: true },
      }),
      this.prisma.videoPurchase.findMany({
        where: { userId },
        select: { createdAt: true, amountMinor: true, currency: true, status: true },
      }),
      this.prisma.payment.findMany({
        where: { userId },
        select: {
          id: true,
          type: true,
          status: true,
          amountMinor: true,
          currency: true,
          createdAt: true,
          paidAt: true,
        },
      }),
      this.prisma.userLocation.findUnique({
        where: { userId },
        select: {
          latitude: true,
          longitude: true,
          accuracyM: true,
          recordedAt: true,
          areaNode: { select: { name: true } },
        },
      }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      user,
      profile,
      photos,
      contactUnlocks: unlocks,
      videoPurchases: purchases,
      payments,
      location,
    };
  }
}

export const normalizePhone = normalisePhone;
export type RequestContext = { ip?: string; userAgent?: string; deviceId?: string; deviceName?: string };
