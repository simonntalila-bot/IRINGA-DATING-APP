import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../common/prisma/prisma.service';
import { EncryptionService, normalisePhone } from '../common/crypto/encryption.service';

/**
 * Admin authentication.
 *
 * Admins sign in on a separate endpoint with their own credentials and receive
 * a normal access token, but the token only carries `isAdmin` when an
 * ACTIVE AdminUser row exists. Nothing else can grant admin rights, and the
 * promotion endpoint requires SUPER_ADMIN.
 */
@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async login(email: string, password: string): Promise<{ userId: string; role: AdminRole; isAdmin: true }> {
    const admin = await this.prisma.adminUser.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true, userId: true, passwordHash: true, role: true, isActive: true },
    });

    const hash = admin?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const ok = await bcrypt.compare(password, hash);

    if (!admin || !ok) throw new UnauthorizedException('Invalid admin credentials');
    if (!admin.isActive) throw new UnauthorizedException('This admin account is disabled');

    // The admin has to link to a real user row for JWT strategy validation.
    if (!admin.userId) {
      throw new UnauthorizedException('This admin account is not linked to a user yet');
    }

    await this.prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });

    await this.prisma.sensitiveAccessLog.create({
      data: { actorId: admin.userId, actorRole: admin.role, action: 'admin.login' },
    });

    return { userId: admin.userId, role: admin.role, isAdmin: true };
  }

  /** SUPER_ADMIN only. Creates (or links) an admin for an existing user. */
  async promote(
    email: string,
    password: string,
    role: AdminRole,
    linkToUserId?: string,
  ): Promise<{ id: string; email: string }> {
    if (role === AdminRole.SUPER_ADMIN && linkToUserId) {
      const existingSuper = await this.prisma.adminUser.count({ where: { role: AdminRole.SUPER_ADMIN } });
      // More than one super admin is fine; this is just logged for audit.
      this.logger.log(`Creating another SUPER_ADMIN (existing: ${existingSuper})`);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await this.prisma.adminUser.upsert({
      where: { email: email.toLowerCase() },
      create: { email: email.toLowerCase(), passwordHash, role, userId: linkToUserId, isActive: true },
      update: { passwordHash, role, userId: linkToUserId ?? undefined, isActive: true },
      select: { id: true, email: true, role: true, userId: true },
    });

    if (linkToUserId) {
      await this.prisma.user.update({ where: { id: linkToUserId }, data: { isAdmin: true } });
    }

    await this.prisma.sensitiveAccessLog.create({
      data: {
        actorId: linkToUserId ?? null,
        actorRole: AdminRole.SUPER_ADMIN,
        subjectId: linkToUserId ?? null,
        action: 'admin.promote',
        reason: email,
      },
    });

    return { id: admin.id, email: admin.email };
  }

  /**
   * Sensitive read with an audit trail (spec section 26). Admin staff should not
   * casually browse phone numbers, so a reason is mandatory and every access is
   * written to sensitive_access_logs.
   */
  async readContactForSubject(
    adminId: string,
    adminRole: AdminRole,
    subjectId: string,
    reason: string,
  ): Promise<{ phone: string | null; whatsapp: string | null; loggedAt: string }> {
    if (reason.trim().length < 8) {
      throw new BadRequestException('A reason of at least 8 characters is required to read contact data');
    }
    if (adminRole !== AdminRole.SUPER_ADMIN && adminRole !== AdminRole.ADMIN) {
      throw new BadRequestException('Only ADMIN or SUPER_ADMIN may read contact data');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: subjectId },
      select: { phoneEncrypted: true, whatsappEncrypted: true },
    });
    if (!user) throw new BadRequestException('User not found');

    const loggedAt = new Date().toISOString();
    await this.prisma.sensitiveAccessLog.create({
      data: {
        actorId: adminId,
        actorRole: adminRole,
        subjectId,
        action: 'admin.contact.read',
        reason: reason.trim(),
      },
    });

    return {
      phone: this.encryption.tryDecrypt(user.phoneEncrypted),
      whatsapp: this.encryption.tryDecrypt(user.whatsappEncrypted),
      loggedAt,
    };
  }

  /** Helper for the seed and for OTP-less admin tooling. */
  async ensureBootstrapAdmin(email: string, password: string, role: AdminRole = AdminRole.SUPER_ADMIN) {
    const passwordHash = await bcrypt.hash(password, 12);
    await this.prisma.adminUser.upsert({
      where: { email },
      create: { email, passwordHash, role, isActive: true },
      update: {},
    });
  }

  /** Audit trail surfaced in the admin UI. */
  async listSensitiveAccess(limit = 100) {
    return this.prisma.sensitiveAccessLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
      select: {
        id: true,
        actorId: true,
        actorRole: true,
        subjectId: true,
        action: true,
        reason: true,
        createdAt: true,
      },
    });
  }

  /** Explicit writer so every sensitive action has one call site. */
  async logSensitiveAccess(entry: {
    actorId: string | null;
    actorRole: string | null;
    subjectId: string | null;
    action: string;
    reason?: string;
  }): Promise<void> {
    await this.prisma.sensitiveAccessLog.create({
      data: {
        actorId: entry.actorId,
        actorRole: entry.actorRole,
        subjectId: entry.subjectId,
        action: entry.action,
        reason: entry.reason,
      },
    });
  }

  static normalisePhone = normalisePhone;
}
