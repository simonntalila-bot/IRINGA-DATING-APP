import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PaymentType, ProductType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { EntitlementService } from '../entitlements/entitlement.service';
import { PaymentsService, type PaymentReceipt } from '../payments/payments.service';
import { PrivacyService } from '../privacy/privacy.service';
import { UsersService } from '../users/users.service';

/** Business rule 3: one target profile contact unlock = TZS 1,000. */
export const CONTACT_UNLOCK_PRICE_MINOR = 100_000;
export const CURRENCY = 'TZS';

@Injectable()
export class ContactUnlockService {
  private readonly logger = new Logger(ContactUnlockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly entitlements: EntitlementService,
    private readonly privacy: PrivacyService,
    private readonly users: UsersService,
  ) {}

  /**
   * What the "Get contact" button should show. It never returns the number
   * itself - only the price and whether it is already owned.
   */
  async quote(
    viewerId: string,
    targetId: string,
  ): Promise<{
    priceMinor: number;
    currency: string;
    alreadyUnlocked: boolean;
    ownerAllowsContact: boolean;
    ownerDisplayName: string;
    canPurchase: boolean;
    blockedReason: string | null;
  }> {
    await this.users.assertCanInteract(viewerId, targetId);

    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { profile: { select: { displayName: true } } },
    });
    if (!target?.profile) throw new NotFoundException('Profile not found');

    const [{ alreadyOwned }, allowsContact] = await Promise.all([
      this.payments.existingItem(viewerId, ProductType.CONTACT_UNLOCK, targetId),
      this.privacy.ownerAllowsContact(targetId),
    ]);

    const blockedEitherWay = await this.users.isBlockedEitherWay(viewerId, targetId);

    return {
      priceMinor: CONTACT_UNLOCK_PRICE_MINOR,
      currency: CURRENCY,
      alreadyUnlocked: alreadyOwned,
      ownerAllowsContact: allowsContact,
      ownerDisplayName: target.profile.displayName,
      canPurchase: !alreadyOwned && allowsContact && !blockedEitherWay,
      blockedReason: blockedEitherWay ? 'BLOCKED' : allowsContact ? null : 'OWNER_CONTACT_SHARING_DISABLED',
    };
  }

  /**
   * Starts the purchase. Returns the pending payment; the contact is unlocked
   * only after the gateway webhook confirms SUCCESS (rule 8).
   */
  async purchase(viewerId: string, targetId: string, idempotencyKey: string): Promise<PaymentReceipt> {
    if (viewerId === targetId) throw new BadRequestException('You cannot unlock your own contact');
    await this.users.assertCanInteract(viewerId, targetId);

    const { alreadyUnlocked, canPurchase, ownerDisplayName } = await this.quote(viewerId, targetId);

    if (alreadyUnlocked) {
      // Rule 4: never charge twice for the same person.
      throw new BadRequestException({
        message: 'You have already unlocked this contact',
        code: 'ALREADY_UNLOCKED',
      });
    }
    if (!canPurchase) {
      throw new ForbiddenException({
        message: 'This person is not sharing contact details right now',
        code: 'OWNER_CONTACT_SHARING_DISABLED',
      });
    }

    this.logger.log(`Contact unlock purchase started by ${viewerId} for ${targetId} (${ownerDisplayName})`);

    return this.payments.createPayment({
      userId: viewerId,
      type: PaymentType.CONTACT_UNLOCK,
      items: [
        {
          productType: ProductType.CONTACT_UNLOCK,
          productId: targetId,
          amountMinor: CONTACT_UNLOCK_PRICE_MINOR,
        },
      ],
      idempotencyKey,
      metadata: { targetUserId: targetId },
    });
  }

  /**
   * The contact card. Returns real numbers only when the entitlement AND the
   * owner's consent are both present, and records the access in the audit log.
   */
  async contactCard(viewerId: string, targetId: string) {
    await this.users.assertCanInteract(viewerId, targetId);

    const card = await this.entitlements.contactCard(viewerId, targetId);

    await this.prisma.sensitiveAccessLog.create({
      data: {
        actorId: viewerId,
        actorRole: 'user',
        subjectId: targetId,
        action: 'contact.view',
        reason: card.entitlementActive ? 'entitled buyer' : 'blocked attempt',
      },
    });

    return card;
  }

  /** Confirms the unlock landed (used after the webhook returns). */
  async status(viewerId: string, targetId: string): Promise<{ unlocked: boolean; unlockedAt: string | null }> {
    const row = await this.prisma.contactUnlock.findUnique({
      where: { buyerId_profileOwnerId: { buyerId: viewerId, profileOwnerId: targetId } },
      select: { status: true, createdAt: true },
    });
    return { unlocked: row?.status === 'ACTIVE', unlockedAt: row?.createdAt.toISOString() ?? null };
  }

  /** Owner-side control: turn contact sharing on/off. Effective immediately. */
  async setOwnerSharing(ownerId: string, allowContactSharing: boolean, allowWhatsAppSharing?: boolean): Promise<void> {
    await this.privacy.update(ownerId, {
      allowContactSharing,
      ...(allowWhatsAppSharing != null ? { allowWhatsAppSharing } : {}),
      ...(allowWhatsAppSharing === true ? { allowContactSharing: true } : {}),
    });

    await this.prisma.sensitiveAccessLog.create({
      data: {
        actorId: ownerId,
        actorRole: 'owner',
        subjectId: ownerId,
        action: allowContactSharing ? 'contact.sharing.enabled' : 'contact.sharing.disabled',
      },
    });

    // Purchases are NOT refunded automatically - that is a business decision.
    // Access simply stops, which is the privacy requirement.
    this.logger.log(`${ownerId} set contact sharing to ${allowContactSharing}`);
  }

  async setWhatsApp(ownerId: string, allowWhatsAppSharing: boolean): Promise<void> {
    if (allowWhatsAppSharing) {
      const unlockCount = await this.prisma.contactUnlock.count({
        where: { profileOwnerId: ownerId, status: 'ACTIVE' },
      });
      this.logger.log(`${ownerId} enabled WhatsApp for ${unlockCount} existing unlock(s)`);
    }
    await this.setOwnerSharing(ownerId, allowWhatsAppSharing, allowWhatsAppSharing);
  }
}
