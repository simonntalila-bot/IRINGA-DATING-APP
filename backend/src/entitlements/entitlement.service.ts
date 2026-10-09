import { Injectable, Logger } from '@nestjs/common';
import { EntitlementType, type Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrivacyService } from '../privacy/privacy.service';
import { UsersService } from '../users/users.service';
import { EncryptionService } from '../common/crypto/encryption.service';

/**
 * Central authorisation layer.
 *
 * Business rule: nothing in this codebase decides "is this person allowed to see
 * that?" on its own. Every protected feature calls one of the `can*` methods
 * here, which combines:
 *
 *   - an ENTITLEMENT (a payment that the server verified), and
 *   - the OWNER's live consent,
 *   - and the absence of a block.
 *
 * This is why the mobile app can never grant itself access: it has no way to
 * make these methods return true.
 */
@Injectable()
export class EntitlementService {
  private readonly logger = new Logger(EntitlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly privacy: PrivacyService,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
    private readonly encryption: EncryptionService,
  ) {}

  // --- Granting ----------------------------------------------------------

  /**
   * Idempotent grant. Called only from verified payment webhooks.
   * `resourceId` is the profile owner id for contacts, the video id for media.
   */
  async grant(
    userId: string,
    type: EntitlementType,
    resourceId: string | null,
    paymentItemId?: string | null,
    expiresAt?: Date | null,
  ): Promise<{ granted: boolean; entitlementId: string }> {
    // findFirst, not findUnique: a composite unique that includes a nullable
    // column cannot be used as a where-unique key when resourceId is null.
    const existing = await this.prisma.entitlement.findFirst({
      where: { userId, type, resourceId },
      select: { id: true, revokedAt: true },
    });

    if (existing && !existing.revokedAt) {
      this.logger.log(`Entitlement ${type} for ${userId} already active (${existing.id})`);
      return { granted: false, entitlementId: existing.id };
    }

    const entitlement = existing
      ? await this.prisma.entitlement.update({
          where: { id: existing.id },
          data: {
            revokedAt: null,
            revokedReason: null,
            startsAt: new Date(),
            expiresAt: expiresAt ?? null,
            paymentItemId: paymentItemId ?? null,
          },
          select: { id: true },
        })
      : await this.prisma.entitlement.create({
          data: { userId, type, resourceId, paymentItemId: paymentItemId ?? null, expiresAt: expiresAt ?? null },
          select: { id: true },
        });

    return { granted: true, entitlementId: entitlement.id };
  }

  async revoke(userId: string, type: EntitlementType, resourceId: string | null, reason: string): Promise<void> {
    await this.prisma.entitlement.updateMany({
      where: { userId, type, resourceId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  async has(userId: string, type: EntitlementType, resourceId: string | null): Promise<boolean> {
    const row = await this.prisma.entitlement.findFirst({
      where: {
        userId,
        type,
        resourceId,
        revokedAt: null,
        startsAt: { lte: new Date() },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true },
    });
    return row !== null;
  }

  // --- Questions the rest of the app asks --------------------------------

  async canViewFullProfile(viewerId: string, targetId: string): Promise<boolean> {
    if (viewerId === targetId) return true;
    return this.has(viewerId, EntitlementType.CONTACT_UNLOCK, targetId);
  }

  /**
   * The phone number requires BOTH a paid entitlement AND the owner's consent
   * right now. If the owner turns sharing off, access stops immediately even
   * though the payment succeeded.
   */
  async canViewPhone(viewerId: string, targetId: string): Promise<boolean> {
    if (viewerId === targetId) return true;
    if (await this.users.isBlockedEitherWay(viewerId, targetId)) return false;
    if (!(await this.privacy.ownerAllowsContact(targetId))) return false;

    const unlock = await this.prisma.contactUnlock.findUnique({
      where: { buyerId_profileOwnerId: { buyerId: viewerId, profileOwnerId: targetId } },
      select: { status: true, phoneUnlocked: true },
    });
    return unlock?.status === 'ACTIVE' && unlock.phoneUnlocked;
  }

  async canViewWhatsApp(viewerId: string, targetId: string): Promise<boolean> {
    if (viewerId === targetId) return true;
    if (!(await this.canViewPhone(viewerId, targetId))) return false;
    if (!(await this.privacy.ownerAllowsWhatsApp(targetId))) return false;

    const owner = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { whatsappEncrypted: true },
    });
    return !!owner?.whatsappEncrypted;
  }

  async canUseCall(viewerId: string, targetId: string): Promise<boolean> {
    if (viewerId === targetId) return false;
    if (!(await this.canViewPhone(viewerId, targetId))) return false;
    return this.privacy.ownerAllowsCalls(targetId);
  }

  async canViewPremiumVideo(userId: string, videoId: string): Promise<boolean> {
    const video = await this.prisma.premiumVideo.findUnique({
      where: { id: videoId },
      select: { isPremium: true, status: true },
    });
    if (!video || video.status !== 'PUBLISHED') return false;
    if (!video.isPremium) return true;

    const purchase = await this.prisma.videoPurchase.findUnique({
      where: { userId_videoId: { userId, videoId } },
      select: { status: true },
    });
    return purchase?.status === 'ACTIVE';
  }

  async canUsePremiumFeature(userId: string, feature: string): Promise<boolean> {
    return this.has(userId, EntitlementType.FEATURE_FLAG, feature);
  }

  /**
   * Live location is never a payment product. It requires an ACTIVE, unexpired
   * LocationSharePermission that the owner granted, plus their standing
   * permission to receive requests at all.
   */
  async canUseLiveLocation(viewerId: string, ownerId: string): Promise<boolean> {
    if (viewerId === ownerId) return true;
    if (await this.users.isBlockedEitherWay(viewerId, ownerId)) return false;
    if (!(await this.privacy.ownerAllowsLocationRequests(ownerId))) return false;

    const permission = await this.prisma.locationSharePermission.findFirst({
      where: { ownerId, recipientId: viewerId, endedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    return permission !== null;
  }

  // --- Disclosures -------------------------------------------------------

  /**
   * Returns contact data ONLY when entitled. The result shape is what the
   * profile screen renders - note there is no branch that returns a number
   * without a passing entitlement check.
   */
  async contactCard(viewerId: string, targetId: string) {
    const [canPhone, canWhatsApp, canCall, canLocation] = await Promise.all([
      this.canViewPhone(viewerId, targetId),
      this.canViewWhatsApp(viewerId, targetId),
      this.canUseCall(viewerId, targetId),
      this.canUseLiveLocation(viewerId, targetId),
    ]);

    const owner = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { phoneEncrypted: true, whatsappEncrypted: true },
    });

    const phone = canPhone ? this.encryption.tryDecrypt(owner?.phoneEncrypted) : null;
    const whatsapp = canWhatsApp ? this.encryption.tryDecrypt(owner?.whatsappEncrypted) : null;

    return {
      phone,
      phoneMasked: canPhone ? phone : EncryptionService.mask(this.encryption.tryDecrypt(owner?.phoneEncrypted)),
      whatsapp,
      whatsappUrl: whatsapp ? `https://wa.me/${whatsapp.replace(/\D/g, '')}` : null,
      canCall,
      canRequestLocation: canLocation,
      entitlementActive: canPhone || canWhatsApp,
      /** Tells the UI exactly why access is missing, without leaking anything. */
      reason: canPhone
        ? null
        : (await this.privacy.ownerAllowsContact(targetId))
          ? 'NO_UNLOCK'
          : 'OWNER_CONTACT_SHARING_DISABLED',
    } satisfies {
      phone: string | null;
      phoneMasked: string | null;
      whatsapp: string | null;
      whatsappUrl: string | null;
      canCall: boolean;
      canRequestLocation: boolean;
      entitlementActive: boolean;
      reason: string | null;
    };
  }

  async notifyEntitlementGranted(userId: string, kind: 'contact' | 'video', label: string): Promise<void> {
    await this.notifications.send({
      userId,
      type: kind === 'contact' ? 'PROFILE_VIEW' : 'NEW_MESSAGE',
      title: kind === 'contact' ? 'Contact unlocked' : 'Video unlocked',
      body: kind === 'contact' ? `You can now see the contact details for ${label}.` : `${label} is ready to watch.`,
      data: { kind },
    });
  }

  /** Expires time-limited entitlements. Called by the maintenance job. */
  async purgeExpired(): Promise<number> {
    const result = await this.prisma.entitlement.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }

  /** Used by admin tooling; never by user-facing endpoints. */
  async whereHas(
    userId: string,
    type: EntitlementType,
    resourceId: string | null,
  ): Promise<Prisma.EntitlementWhereInput> {
    return { userId, type, resourceId, revokedAt: null };
  }
}
