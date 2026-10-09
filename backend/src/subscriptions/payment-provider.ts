import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { SubscriptionTier } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppConfig } from '../common/config/app-config';

export interface CheckoutRequest {
  userId: string;
  tier: Exclude<SubscriptionTier, 'FREE'>;
  idempotencyKey: string;
  phone: string;
}

export interface CheckoutResult {
  provider: string;
  reference: string;
  status: 'PENDING' | 'SUCCEEDED';
  /** A real gateway returns a redirect/SDK payload here. */
  checkout?: Record<string, unknown>;
}

export interface WebhookEvent {
  provider: string;
  reference: string;
  status: 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
  idempotencyKey: string;
}

/**
 * Payment provider abstraction.
 *
 * The rest of the application only talks to this interface, so swapping
 * M-Pesa / Stripe / Flutterwave for a local implementation never touches
 * subscription logic. No real credentials or fake production keys ship here.
 */
export interface PaymentProvider {
  readonly name: string;
  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;
  verifyWebhook(rawBody: Buffer, signature: string | undefined): WebhookEvent;
}

@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  private readonly logger = new Logger(MockPaymentProvider.name);

  constructor(private readonly config: AppConfig) {}

  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    const reference = `mock_${request.idempotencyKey}`;
    this.logger.log(`Mock checkout for ${request.phone} tier=${request.tier} ref=${reference}. No money moves.`);
    return { provider: this.name, reference, status: 'PENDING' };
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): WebhookEvent {
    const expected = createHmac('sha256', this.config.paymentWebhookSecret).update(rawBody).digest('hex');
    if (!signature || !safeEqual(expected, signature)) {
      throw new BadRequestException('Invalid webhook signature');
    }
    return JSON.parse(rawBody.toString('utf8')) as WebhookEvent;
  }
}

@Injectable()
export class PaymentProviderFactory {
  constructor(private readonly config: AppConfig) {}

  create(): PaymentProvider {
    switch (this.config.paymentProvider) {
      case 'mock':
      default:
        return new MockPaymentProvider(this.config);
    }
  }
}

const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};
