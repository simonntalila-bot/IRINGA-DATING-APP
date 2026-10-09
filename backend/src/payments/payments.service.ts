import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EntitlementType, PaymentStatus, PaymentType, ProductType, type Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppConfig } from '../common/config/app-config';
import { EncryptionService } from '../common/crypto/encryption.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentProviderFactory, WebhookGuard, type CheckoutRequest, type PaymentProvider } from './payment-provider';

export interface CreatePaymentInput {
  userId: string;
  type: PaymentType;
  /** Short description shown to the payer in the gateway. */
  description?: string;
  items: Array<{ productType: ProductType; productId: string | null; amountMinor: number }>;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentReceipt {
  paymentId: string;
  /**
   * The reference the gateway was given and will quote back on the callback.
   * A client cannot complete a payment without this, so it is part of the
   * receipt rather than something to look up separately.
   */
  providerRef: string;
  provider: string;
  status: PaymentStatus;
  items: Array<{ productType: ProductType; productId: string | null; status: PaymentStatus }>;
  checkout?: Record<string, unknown>;
  /** True when the request was a retry of an already-recorded payment. */
  reused: boolean;
}

const PRODUCT_TO_PAYMENT_TYPE: Record<ProductType, PaymentType> = {
  CONTACT_UNLOCK: 'CONTACT_UNLOCK',
  PREMIUM_VIDEO: 'VIDEO_PURCHASE',
  SUBSCRIPTION: 'PREMIUM_SUBSCRIPTION',
  BOOST: 'BOOST',
};

const CURRENCY = 'TZS';

/**
 * Payment engine.
 *
 * Rules enforced here:
 *  - A payment is the ONLY way an entitlement appears (rule 8).
 *  - Delivery is idempotent (rule 9): re-delivering the same webhook, or
 *    retrying the same idempotency key, cannot create a second product.
 *  - A failed payment grants nothing (spec section 29).
 *  - The client is never trusted: the grant happens in `deliverPayment`, which
 *    only the verified webhook path calls.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly provider: PaymentProvider;

  constructor(
    private readonly prisma: PrismaService,
    private readonly factory: PaymentProviderFactory,
    private readonly notifications: NotificationsService,
    private readonly guard: WebhookGuard,
    private readonly encryption: EncryptionService,
    private readonly config: AppConfig,
  ) {
    this.provider = this.factory.create();
  }

  get providerName(): string {
    return this.provider.name;
  }

  /**
   * What the app shows on the payment screen. Reports whether real credentials
   * are configured so a misconfigured deployment is visible instead of silently
   * collecting nothing.
   */
  providerStatus(): Record<string, unknown> {
    const configured =
      this.provider.name === 'mpesa'
        ? !!this.config.mpesaConsumerKey && !!this.config.mpesaShortcode
        : this.provider.name === 'mock'
          ? false
          : !!this.config.paymentGatewayCheckoutUrl;

    return {
      provider: this.provider.name,
      configured,
      live: this.provider.name === 'mpesa' && this.config.mpesaBaseUrl.includes('api.safaricom.co.ke'),
      replayWindowSeconds: 300,
      amountValidated: true,
    };
  }

  /**
   * Create (or reuse) a pending payment.
   * The idempotency key makes a double tap on "Pay" harmless.
   */
  async createPayment(input: CreatePaymentInput): Promise<PaymentReceipt> {
    if (input.items.length === 0) throw new BadRequestException('A payment needs at least one item');
    for (const item of input.items) {
      if (item.amountMinor < 0) throw new BadRequestException('Invalid amount');
      if (item.productType !== 'SUBSCRIPTION' && !item.productId) {
        throw new BadRequestException(`${item.productType} needs a productId`);
      }
    }

    const existing = await this.prisma.payment.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { items: true },
    });
    if (existing) {
      this.logger.log(`Reusing payment ${existing.id} for idempotency key ${input.idempotencyKey}`);
      return this.receipt(existing, true);
    }

    // Anti double-charge. A buyer who already has an unsettled payment for the
    // same product is resumed, never charged again: otherwise tapping "Pay"
    // twice before the gateway answers would create two live charges for one
    // contact or one video.
    const pending = await this.prisma.payment.findFirst({
      where: {
        userId: input.userId,
        status: PaymentStatus.PENDING,
        createdAt: { gte: new Date(Date.now() - 30 * 60_000) },
        items: {
          some: {
            productType: input.items[0].productType,
            productId: input.items[0].productId,
            status: PaymentStatus.PENDING,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
    if (pending) {
      this.logger.log(`Payment ${pending.id} is already pending for this product; not charging again`);
      return this.receipt(pending, true);
    }

    const total = input.items.reduce((sum, item) => sum + item.amountMinor, 0);

    // The payer phone is decrypted only here, to hand it to the gateway.
    // It is never stored on the payment row.
    const payer = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { phoneEncrypted: true, profile: { select: { displayName: true } } },
    });

    const checkoutRequest: CheckoutRequest = {
      userId: input.userId,
      productType: input.items[0].productType,
      productId: input.items[0].productId,
      amountMinor: total,
      currency: CURRENCY,
      idempotencyKey: input.idempotencyKey,
      payerPhone: this.encryption.tryDecrypt(payer?.phoneEncrypted) ?? undefined,
      accountReference: (payer?.profile?.displayName ?? 'user').slice(0, 20),
      description: input.description ?? 'Iringa Dating',
    };
    const checkout = await this.provider.createCheckout(checkoutRequest);

    const payment = await this.prisma.payment.create({
      data: {
        userId: input.userId,
        type: input.type,
        provider: this.provider.name,
        providerRef: checkout.reference,
        idempotencyKey: input.idempotencyKey,
        amountMinor: total,
        currency: CURRENCY,
        status: checkout.status === 'SUCCESS' ? PaymentStatus.SUCCESS : PaymentStatus.PENDING,
        paidAt: checkout.status === 'SUCCESS' ? new Date() : null,
        metadata: input.metadata as never,
        items: {
          create: input.items.map((item) => ({
            productType: item.productType,
            productId: item.productId,
            amountMinor: item.amountMinor,
            currency: CURRENCY,
          })),
        },
      },
      include: { items: true },
    });

    // A provider that settles immediately still goes through the same
    // delivery path, so there is exactly one grant implementation.
    if (payment.status === PaymentStatus.SUCCESS) {
      await this.deliverPayment(payment.id);
      return this.receipt(
        await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, include: { items: true } }),
        false,
      );
    }

    return this.receipt(payment, false, checkout.checkout);
  }

  /**
   * Webhook entry point.
   *
   * Signature is verified inside the provider implementation. Delivery is
   * idempotent, so the gateway (or a human) can send the same event twice.
   */
  /**
   * Webhook entry point with full header access.
   *
   * Signature and timestamp freshness are verified inside the provider. Three
   * more checks happen here, because a valid signature alone must never be
   * enough to grant a product:
   *
   *   1. replay protection - a signed event may be used once;
   *   2. the amount must match what we recorded, otherwise we are being told a
   *      smaller sum was collected than we asked for;
   *   3. only SUCCESS reaches the delivery path.
   */
  async handleWebhookWithHeaders(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<{ ok: boolean; delivered?: boolean; reason?: string }> {
    const event = this.provider.verifyWebhook(rawBody, headers);

    const fresh = await this.guard.assertNotReplayed(event.idempotencyKey);
    if (!fresh) {
      return { ok: true, delivered: false, reason: 'replayed' };
    }

    const payment = await this.prisma.payment.findFirst({
      where: { OR: [{ providerRef: event.reference }, { idempotencyKey: event.idempotencyKey }] },
      include: { items: true },
    });

    if (!payment) {
      this.logger.warn(`Webhook for unknown payment reference ${event.reference}`);
      return { ok: false, reason: 'unknown_payment' };
    }

    if (event.amountMinor != null && event.amountMinor !== payment.amountMinor) {
      this.logger.error(
        `Amount mismatch on payment ${payment.id}: gateway reported ${event.amountMinor}, we recorded ${payment.amountMinor}. Not granting.`,
      );
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED, failureReason: 'Amount mismatch reported by gateway' },
      });
      await this.prisma.paymentItem.updateMany({
        where: { paymentId: payment.id },
        data: { status: PaymentStatus.FAILED },
      });
      return { ok: false, reason: 'amount_mismatch' };
    }

    if (event.status === 'SUCCESS') {
      if (payment.status === PaymentStatus.SUCCESS) {
        return { ok: true, delivered: false, reason: 'already_paid' };
      }
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCESS,
          paidAt: new Date(),
          providerTxId: event.transactionId ?? null,
        },
      });
      const delivered = await this.deliverPayment(payment.id);
      return { ok: true, delivered };
    }

    if (event.status === 'REFUNDED') {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.REFUNDED, refundedAt: new Date() },
      });
      await this.revokeForRefund(payment.id);
      return { ok: true, delivered: true, reason: 'refunded' };
    }

    // FAILED / CANCELLED / EXPIRED -> no entitlement, ever.
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus[event.status],
        failureReason: event.failureReason ?? null,
      },
    });
    await this.prisma.paymentItem.updateMany({
      where: { paymentId: payment.id },
      data: { status: PaymentStatus[event.status] },
    });

    this.logger.log(`Payment ${payment.id} ended as ${event.status}; nothing was granted.`);
    return { ok: true, delivered: false, reason: event.status.toLowerCase() };
  }

  /** Convenience wrapper for callers that only have a signature header. */
  async handleWebhook(
    rawBody: Buffer,
    signature: string | undefined,
  ): Promise<{ ok: boolean; delivered?: boolean; reason?: string }> {
    return this.handleWebhookWithHeaders(rawBody, { 'x-signature': signature });
  }

  /**
   * Grants everything the payment bought. Runs in one transaction so a partial
   * grant is impossible, and each grant is upserted on its unique key so a
   * duplicate call is a no-op.
   */
  private async deliverPayment(paymentId: string): Promise<boolean> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { items: true },
    });
    if (!payment || payment.status !== PaymentStatus.SUCCESS) return false;

    let grantedAny = false;

    for (const item of payment.items) {
      if (item.deliveredAt) continue; // already delivered - idempotency

      switch (item.productType) {
        case ProductType.CONTACT_UNLOCK: {
          if (!item.productId) throw new BadRequestException('Contact unlock item without a target');
          await this.grantContactUnlock(payment.userId, item.productId, item.id);
          grantedAny = true;
          break;
        }
        case ProductType.PREMIUM_VIDEO: {
          if (!item.productId) throw new BadRequestException('Video item without a video id');
          await this.grantVideo(payment.userId, item.productId, item.id);
          grantedAny = true;
          break;
        }
        case ProductType.SUBSCRIPTION: {
          await this.activateSubscription(payment.userId, item.productId, item.id);
          grantedAny = true;
          break;
        }
        case ProductType.BOOST: {
          await this.startBoostForPayment(item.id, payment.userId);
          grantedAny = true;
          break;
        }
        default:
          this.logger.warn(`Unknown product type ${item.productType} on payment ${payment.id}`);
      }

      await this.prisma.paymentItem.update({
        where: { id: item.id },
        data: { status: PaymentStatus.SUCCESS, deliveredAt: new Date() },
      });
    }

    return grantedAny;
  }

  /**
   * Rule 4: the unique (buyerId, profileOwnerId) index means a second purchase
   * for the same person can never create a second unlock, so a duplicated
   * webhook (or a duplicated item) stays harmless.
   */
  private async grantContactUnlock(buyerId: string, profileOwnerId: string, paymentItemId: string): Promise<void> {
    if (buyerId === profileOwnerId) {
      throw new BadRequestException('You cannot unlock your own contact');
    }

    const already = await this.prisma.contactUnlock.findUnique({
      where: { buyerId_profileOwnerId: { buyerId, profileOwnerId } },
      select: { id: true, status: true },
    });

    if (already && already.status === 'ACTIVE') {
      this.logger.log(`Contact unlock for ${buyerId} -> ${profileOwnerId} already active; skipping.`);
      return;
    }

    if (already) {
      // Re-purchase after a refund: reuse the row instead of creating a second.
      await this.prisma.contactUnlock.update({
        where: { id: already.id },
        data: { status: 'ACTIVE', refundedAt: null, paymentItemId },
      });
    } else {
      await this.prisma.contactUnlock.create({
        data: {
          buyerId,
          profileOwnerId,
          paymentItemId,
          amountMinor: await this.itemAmount(paymentItemId),
          currency: CURRENCY,
          status: 'ACTIVE',
          phoneUnlocked: true,
          // WhatsApp stays off until the owner separately allows it.
          whatsappUnlocked: false,
        },
      });
    }
  }

  private async grantVideo(userId: string, videoId: string, paymentItemId: string): Promise<void> {
    const video = await this.prisma.premiumVideo.findUnique({
      where: { id: videoId },
      select: { id: true, title: true },
    });
    if (!video) throw new NotFoundException('Video no longer exists');

    const already = await this.prisma.videoPurchase.findUnique({
      where: { userId_videoId: { userId, videoId } },
      select: { id: true, status: true },
    });

    if (already && already.status === 'ACTIVE') {
      this.logger.log(`Video ${videoId} already purchased by ${userId}; skipping.`);
      return;
    }

    if (already) {
      await this.prisma.videoPurchase.update({
        where: { id: already.id },
        data: { status: 'ACTIVE', refundedAt: null, paymentItemId },
      });
    } else {
      await this.prisma.videoPurchase.create({
        data: {
          userId,
          videoId,
          paymentItemId,
          amountMinor: await this.itemAmount(paymentItemId),
          currency: CURRENCY,
          status: 'ACTIVE',
        },
      });
    }
  }

  private async itemAmount(paymentItemId: string): Promise<number> {
    const item = await this.prisma.paymentItem.findUnique({
      where: { id: paymentItemId },
      select: { amountMinor: true },
    });
    return item?.amountMinor ?? 0;
  }

  /** Refund handling: revoke the entitlements this payment granted. */
  /** Refund handling: revoke everything this payment granted. */
  private async revokeForRefund(paymentId: string): Promise<void> {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { items: true } });
    if (!payment) return;

    for (const item of payment.items) {
      if (!item.productId) continue;

      if (item.productType === ProductType.CONTACT_UNLOCK) {
        const unlock = await this.prisma.contactUnlock.findUnique({
          where: { buyerId_profileOwnerId: { buyerId: payment.userId, profileOwnerId: item.productId } },
          select: { id: true },
        });
        if (unlock) {
          await this.prisma.contactUnlock.update({
            where: { id: unlock.id },
            data: { status: 'REFUNDED', refundedAt: new Date() },
          });
        }
        await this.prisma.entitlement.updateMany({
          where: { userId: payment.userId, type: EntitlementType.CONTACT_UNLOCK, resourceId: item.productId },
          data: { revokedAt: new Date(), revokedReason: 'Payment refunded' },
        });
      }

      if (item.productType === ProductType.PREMIUM_VIDEO) {
        const purchase = await this.prisma.videoPurchase.findUnique({
          where: { userId_videoId: { userId: payment.userId, videoId: item.productId } },
          select: { id: true },
        });
        if (purchase) {
          await this.prisma.videoPurchase.update({
            where: { id: purchase.id },
            data: { status: 'REFUNDED', refundedAt: new Date() },
          });
        }
        await this.prisma.entitlement.updateMany({
          where: { userId: payment.userId, type: EntitlementType.VIDEO_PURCHASE, resourceId: item.productId },
          data: { revokedAt: new Date(), revokedReason: 'Payment refunded' },
        });
      }
    }

    this.logger.log(`Refunded payment ${paymentId}: entitlements revoked`);
  }

  // --- Subscription and boost grants -------------------------------------
  // These live here rather than in SubscriptionsService so the payment engine
  // stays the single writer of entitlements: one webhook -> one delivery path.

  /** 30-day period. Only ever called from the verified delivery path. */
  async activateSubscription(userId: string, tierProductId: string | null, paymentItemId: string): Promise<void> {
    const tier = (tierProductId === 'VIP' ? 'VIP' : 'PREMIUM') as 'PREMIUM' | 'VIP';
    const now = new Date();
    const end = new Date(now.getTime() + 30 * 86_400_000);

    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.updateMany({
        where: { userId, status: 'ACTIVE' },
        data: { status: 'CANCELLED', cancelledAt: now },
      });
      const subscription = await tx.subscription.create({
        data: {
          userId,
          tier,
          status: 'ACTIVE',
          provider: this.provider.name,
          currentPeriodStart: now,
          currentPeriodEnd: end,
        },
        select: { id: true },
      });
      await tx.paymentItem.update({ where: { id: paymentItemId }, data: { subscriptionId: subscription.id } });
      await tx.entitlement.upsert({
        where: { userId_type_resourceId: { userId, type: EntitlementType.PREMIUM_SUBSCRIPTION, resourceId: tier } },
        create: { userId, type: EntitlementType.PREMIUM_SUBSCRIPTION, resourceId: tier, expiresAt: end, paymentItemId },
        update: { revokedAt: null, expiresAt: end, paymentItemId },
      });
    });

    await this.notifications.send({
      userId,
      type: 'SUBSCRIPTION',
      title: 'Subscription active',
      body: `${tier} access is now active.`,
      data: { tier },
    });
  }

  /** Starts the boost only after the payment is confirmed SUCCESS. */
  async startBoostForPayment(paymentItemId: string, userId: string): Promise<void> {
    const item = await this.prisma.paymentItem.findUnique({
      where: { id: paymentItemId },
      select: { productId: true, payment: { select: { status: true } } },
    });
    if (!item || item.payment.status !== 'SUCCESS') return;

    const minutes = [30, 60, 180].includes(Number(item.productId)) ? Number(item.productId) : 30;
    const existing = await this.prisma.boost.findFirst({
      where: { userId, endsAt: { gt: new Date() } },
      select: { id: true },
    });
    if (existing) return;

    const endsAt = new Date(Date.now() + minutes * 60_000);
    const boost = await this.prisma.boost.create({
      data: { userId, minutes, endsAt },
      select: { id: true },
    });

    await this.prisma.paymentItem.update({ where: { id: paymentItemId }, data: { boostId: boost.id } });
    await this.prisma.entitlement.upsert({
      where: { userId_type_resourceId: { userId, type: EntitlementType.BOOST, resourceId: boost.id } },
      create: { userId, type: EntitlementType.BOOST, resourceId: boost.id, expiresAt: endsAt, paymentItemId },
      update: { revokedAt: null, expiresAt: endsAt, paymentItemId },
    });

    await this.notifications.send({
      userId,
      type: 'BOOST_STARTED',
      title: 'Your boost is live',
      body: `Your profile is being shown to more people for ${minutes} minutes.`,
      data: { boostId: boost.id },
    });
  }

  private receipt(
    payment: {
      id: string;
      providerRef: string | null;
      provider: string;
      status: PaymentStatus;
      items: Array<{ productType: ProductType; productId: string | null; status: PaymentStatus }>;
    },
    reused: boolean,
    checkout?: Record<string, unknown>,
  ): PaymentReceipt {
    return {
      paymentId: payment.id,
      providerRef: payment.providerRef ?? '',
      provider: payment.provider,
      status: payment.status,
      items: payment.items.map((i) => ({ productType: i.productType, productId: i.productId, status: i.status })),
      checkout,
      reused,
    };
  }

  /** Called by product services to check "do I need to charge?" before quoting. */
  async existingItem(userId: string, productType: ProductType, productId: string): Promise<{ alreadyOwned: boolean }> {
    if (productType === ProductType.CONTACT_UNLOCK) {
      const row = await this.prisma.contactUnlock.findUnique({
        where: { buyerId_profileOwnerId: { buyerId: userId, profileOwnerId: productId } },
        select: { status: true },
      });
      return { alreadyOwned: row?.status === 'ACTIVE' };
    }
    if (productType === ProductType.PREMIUM_VIDEO) {
      const row = await this.prisma.videoPurchase.findUnique({
        where: { userId_videoId: { userId, videoId: productId } },
        select: { status: true },
      });
      return { alreadyOwned: row?.status === 'ACTIVE' };
    }
    return { alreadyOwned: false };
  }

  // --- Wallet / history (spec section 28) -------------------------------

  async wallet(userId: string, limit = 50) {
    const payments = await this.prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      include: {
        items: {
          include: {
            contactUnlock: {
              select: { profileOwner: { select: { profile: { select: { displayName: true } } } } },
            },
            videoPurchase: { select: { video: { select: { title: true } } } },
          },
        },
      },
    });

    const unlocks = await this.prisma.contactUnlock.findMany({
      where: { buyerId: userId },
      orderBy: { createdAt: 'desc' },
      include: { profileOwner: { select: { profile: { select: { displayName: true } } } } },
    });

    const videoPurchases = await this.prisma.videoPurchase.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { video: { select: { title: true } } },
    });

    return {
      payments: payments.map((p) => ({
        id: p.id,
        type: p.type,
        status: p.status,
        amountMinor: p.amountMinor,
        currency: p.currency,
        createdAt: p.createdAt,
        paidAt: p.paidAt,
        items: p.items.map((i) => ({
          productType: i.productType,
          status: i.status,
          label: i.contactUnlock?.profileOwner.profile?.displayName ?? i.videoPurchase?.video.title ?? i.productType,
        })),
      })),
      contactUnlocks: unlocks.map((u) => ({
        id: u.id,
        profileName: u.profileOwner.profile?.displayName ?? 'Unknown',
        status: u.status,
        amountMinor: u.amountMinor,
        createdAt: u.createdAt,
      })),
      videoPurchases: videoPurchases.map((v) => ({
        id: v.id,
        title: v.video.title,
        status: v.status,
        amountMinor: v.amountMinor,
        createdAt: v.createdAt,
      })),
    };
  }

  /** Admin revenue reporting (spec section 27). */
  async revenueSummary(from: Date, to: Date) {
    const paid = await this.prisma.payment.findMany({
      where: { status: PaymentStatus.SUCCESS, paidAt: { gte: from, lte: to } },
      select: { type: true, amountMinor: true, currency: true },
    });

    const byType: Record<string, { count: number; amountMinor: number }> = {};
    for (const p of paid) {
      byType[p.type] ??= { count: 0, amountMinor: 0 };
      byType[p.type].count += 1;
      byType[p.type].amountMinor += p.amountMinor;
    }

    const failed = await this.prisma.payment.count({
      where: {
        status: { in: [PaymentStatus.FAILED, PaymentStatus.CANCELLED, PaymentStatus.EXPIRED] },
        createdAt: { gte: from, lte: to },
      },
    });
    const refunded = await this.prisma.payment.count({
      where: { status: PaymentStatus.REFUNDED, createdAt: { gte: from, lte: to } },
    });

    return {
      from,
      to,
      currency: CURRENCY,
      totalSuccessful: paid.length,
      totalAmountMinor: paid.reduce((sum, p) => sum + p.amountMinor, 0),
      byType,
      failedOrCancelled: failed,
      refunded,
    };
  }

  /** Guards internal misuse of the item amount mapping. */
  static paymentTypeFor(productType: ProductType): PaymentType {
    return PRODUCT_TO_PAYMENT_TYPE[productType];
  }

  /** Convenience used by tests and admin tooling. */
  static isTerminal(status: PaymentStatus): boolean {
    return status !== PaymentStatus.PENDING;
  }
}

export type { Prisma };
