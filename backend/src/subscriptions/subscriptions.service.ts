import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EntitlementType, PaymentType, ProductType, type SubscriptionTier } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { PaymentsService, type PaymentReceipt } from '../payments/payments.service';

export interface TierEntitlements {
  tier: SubscriptionTier;
  unlimitedLikes: boolean;
  seeWhoLikedYou: boolean;
  advancedFilters: boolean;
  boosts: number;
  incognito: boolean;
  priorityDiscovery: boolean;
}

const ENTITLEMENTS: Record<SubscriptionTier, TierEntitlements> = {
  FREE: {
    tier: 'FREE',
    unlimitedLikes: false,
    seeWhoLikedYou: false,
    advancedFilters: false,
    boosts: 0,
    incognito: false,
    priorityDiscovery: false,
  },
  PREMIUM: {
    tier: 'PREMIUM',
    unlimitedLikes: true,
    seeWhoLikedYou: true,
    advancedFilters: true,
    boosts: 1,
    incognito: true,
    priorityDiscovery: false,
  },
  VIP: {
    tier: 'VIP',
    unlimitedLikes: true,
    seeWhoLikedYou: true,
    advancedFilters: true,
    boosts: 3,
    incognito: true,
    priorityDiscovery: true,
  },
};

const TIER_PRICE_MINOR: Record<Exclude<SubscriptionTier, 'FREE'>, number> = {
  PREMIUM: 25_000,
  VIP: 60_000,
};

export const BOOST_PRICE_PER_MINUTE_MINOR = 500;

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  async currentTier(userId: string): Promise<SubscriptionTier> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { userId, status: 'ACTIVE', currentPeriodEnd: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { tier: true },
    });
    return subscription?.tier ?? 'FREE';
  }

  async entitlements(userId: string): Promise<TierEntitlements> {
    return ENTITLEMENTS[await this.currentTier(userId)];
  }

  /**
   * Server-side gate. Called by the endpoints that sell a premium capability -
   * the client is never asked, and never believed.
   */
  async requireEntitlement(userId: string, feature: keyof TierEntitlements): Promise<void> {
    const entitlements = await this.entitlements(userId);
    const value = entitlements[feature];
    if (value === false || value === 0) {
      throw new BadRequestException({
        message: `This feature requires Premium`,
        code: 'PREMIUM_REQUIRED',
        feature,
      });
    }
  }

  async status(userId: string) {
    const [tier, subscription, payments, boost] = await Promise.all([
      this.currentTier(userId),
      this.prisma.subscription.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { tier: true, status: true, currentPeriodStart: true, currentPeriodEnd: true },
      }),
      this.prisma.payment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, type: true, amountMinor: true, currency: true, status: true, createdAt: true },
      }),
      this.prisma.boost.findFirst({
        where: { userId, endsAt: { gt: new Date() } },
        orderBy: { endsAt: 'desc' },
        select: { id: true, endsAt: true, impressions: true },
      }),
    ]);

    return {
      tier,
      entitlements: ENTITLEMENTS[tier],
      subscription,
      payments,
      activeBoost: boost,
      provider: this.payments.providerName,
    };
  }

  /** Create the pending payment; the webhook activates the subscription. */
  async startSubscription(
    userId: string,
    tier: Exclude<SubscriptionTier, 'FREE'>,
    idempotencyKey: string,
  ): Promise<PaymentReceipt> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('Account not found');

    return this.payments.createPayment({
      userId,
      type: PaymentType.PREMIUM_SUBSCRIPTION,
      items: [
        {
          productType: ProductType.SUBSCRIPTION,
          productId: tier,
          amountMinor: TIER_PRICE_MINOR[tier],
        },
      ],
      idempotencyKey,
      metadata: { tier },
    });
  }

  async cancel(userId: string): Promise<void> {
    await this.prisma.subscription.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
  }

  async activateBoost(userId: string, minutes: number, idempotencyKey: string): Promise<PaymentReceipt> {
    if (![30, 60, 180].includes(minutes)) throw new BadRequestException('Boost must be 30, 60 or 180 minutes');

    const active = await this.prisma.boost.findFirst({
      where: { userId, endsAt: { gt: new Date() } },
      select: { id: true },
    });
    if (active) throw new BadRequestException('You already have an active boost');

    const entitlements = await this.entitlements(userId);
    if (entitlements.boosts <= 0) {
      throw new BadRequestException({ message: 'Boosts require Premium', code: 'PREMIUM_REQUIRED', feature: 'boosts' });
    }

    return this.payments.createPayment({
      userId,
      type: PaymentType.BOOST,
      items: [
        {
          productType: ProductType.BOOST,
          productId: String(minutes),
          amountMinor: minutes * BOOST_PRICE_PER_MINUTE_MINOR,
        },
      ],
      idempotencyKey,
      metadata: { minutes },
    });
  }

  // NOTE: subscription and boost activation live in PaymentsService so the
  // webhook has exactly one delivery path.

  async recordImpressions(userId: string): Promise<void> {
    await this.prisma.boost.updateMany({
      where: { userId, endsAt: { gt: new Date() } },
      data: { impressions: { increment: 1 } },
    });
  }

  /** Maintenance: downgrade expired subscriptions and clean stale boosts. */
  async expireEnded(): Promise<number> {
    const expired = await this.prisma.subscription.updateMany({
      where: { status: 'ACTIVE', currentPeriodEnd: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });
    await this.prisma.entitlement.deleteMany({
      where: {
        type: { in: [EntitlementType.PREMIUM_SUBSCRIPTION, EntitlementType.BOOST] },
        expiresAt: { lt: new Date() },
      },
    });
    return expired.count;
  }
}
