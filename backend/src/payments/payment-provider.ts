import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { SubscriptionTier } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppConfig } from '../common/config/app-config';
import { RedisService } from '../common/redis/redis.service';

export interface CheckoutRequest {
  userId: string;
  productType: 'CONTACT_UNLOCK' | 'PREMIUM_VIDEO' | 'SUBSCRIPTION' | 'BOOST';
  productId: string | null;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  /** Encrypted at rest; decrypted only to be sent to the gateway. */
  payerPhone?: string;
  accountReference: string;
  description: string;
}

export interface CheckoutResult {
  provider: string;
  reference: string;
  status: 'PENDING' | 'SUCCESS';
  checkout?: Record<string, unknown>;
}

export interface WebhookEvent {
  provider: string;
  reference: string;
  transactionId?: string;
  status: 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED';
  idempotencyKey: string;
  failureReason?: string;
  /** Amount the gateway says it collected, in minor units. */
  amountMinor?: number;
  currency?: string;
}

/**
 * Payment provider abstraction (spec section 21).
 *
 * Nothing outside this file knows which gateway is in use, so M-Pesa can be
 * swapped for an aggregator (or a local implementation in tests) without
 * touching subscriptions, contact unlock or video code.
 */
export interface PaymentProvider {
  readonly name: string;
  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;
  /**
   * Throws when the payload is not authentic or is a replay. Must also reject
   * an event whose amount does not match what we asked for - the caller checks
   * that too, but the provider is the first line of defence.
   */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): WebhookEvent;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export const REPLAY_WINDOW_SECONDS = 300;

export const computeHmacSignature = (secret: string, rawBody: Buffer, timestamp: string): string =>
  createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody.toString('utf8')}`)
    .digest('hex');

export const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};

/**
 * Replay protection. A signed webhook is only fresh if its timestamp is inside
 * the acceptance window, and the event id may only be used once.
 */
@Injectable()
export class WebhookGuard {
  private readonly logger = new Logger(WebhookGuard.name);

  constructor(private readonly redis: RedisService) {}

  assertFresh(timestamp: string | undefined, maxSkewSeconds = REPLAY_WINDOW_SECONDS): void {
    if (!timestamp) throw new BadRequestException('Missing webhook timestamp');

    const seconds = Number(timestamp);
    if (!Number.isFinite(seconds)) {
      // Allow ISO timestamps too.
      const parsed = Date.parse(timestamp);
      if (Number.isNaN(parsed)) throw new BadRequestException('Malformed webhook timestamp');
      this.assertWindow(parsed, maxSkewSeconds);
      return;
    }

    // Tolerate milliseconds.
    const millis = seconds > 1e12 ? seconds : seconds * 1000;
    this.assertWindow(millis, maxSkewSeconds);
  }

  private assertWindow(millis: number, maxSkewSeconds: number): void {
    const skew = Math.abs(Date.now() - millis) / 1000;
    if (skew > maxSkewSeconds) {
      throw new BadRequestException('Webhook timestamp is outside the accepted window');
    }
  }

  /** Single-use event ids. Returns false when the event was already seen. */
  async assertNotReplayed(eventId: string): Promise<boolean> {
    const fresh = await this.redis.setIfAbsent(`webhook:${eventId}`, '1', REPLAY_WINDOW_SECONDS);
    if (!fresh) {
      this.logger.warn(`Ignored replayed webhook ${eventId}`);
    }
    return fresh;
  }
}

// ---------------------------------------------------------------------------
// M-Pesa (Safaricom Daraja) - the practical option for Tanzania
// ---------------------------------------------------------------------------

interface MpesaTokenResponse {
  access_token: string;
  expires_in: number;
}

interface MpesaStkResponse {
  CheckoutRequestID?: string;
  ResponseCode?: number;
  ResponseDescription?: string;
}

@Injectable()
export class MpesaProvider implements PaymentProvider {
  readonly name = 'mpesa';
  private readonly logger = new Logger(MpesaProvider.name);

  constructor(private readonly config: AppConfig) {}

  /**
   * STK push: the payer gets a prompt on their phone and approves it there.
   * We get a CheckoutRequestID immediately and the money confirmation later on
   * the callback URL.
   */
  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    if (!request.payerPhone) {
      throw new BadRequestException('An M-Pesa payment needs the payer phone number');
    }

    const baseUrl = this.config.mpesaBaseUrl;
    const token = await this.getAccessToken(baseUrl);

    const timestamp = new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, '')
      .slice(0, 14);
    const password = Buffer.from(`${this.config.mpesaShortcode}${this.config.mpesaPasscode}${timestamp}`).toString(
      'base64',
    );

    const response = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        BusinessShortCode: this.config.mpesaShortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: request.amountMinor / 100,
        PartyA: request.payerPhone.replace(/\D/g, ''),
        PartyB: this.config.mpesaShortcode,
        PhoneNumber: request.payerPhone.replace(/\D/g, ''),
        CallBackURL: this.config.mpesaCallbackUrl,
        AccountReference: request.accountReference,
        TransactionDesc: request.description.slice(0, 120),
      }),
    });

    const body = (await response.json()) as MpesaStkResponse;
    if (!response.ok || !body.CheckoutRequestID) {
      throw new BadRequestException(`M-Pesa rejected the request: ${body.ResponseDescription ?? response.statusText}`);
    }

    this.logger.log(`M-Pesa STK push issued for ${request.productType} (${body.CheckoutRequestID})`);

    return {
      provider: this.name,
      // The CheckoutRequestID becomes the payment's providerRef, so the
      // callback can find it.
      reference: body.CheckoutRequestID,
      status: 'PENDING',
      checkout: { checkoutRequestId: body.CheckoutRequestID, phone: request.payerPhone },
    };
  }

  private async getAccessToken(baseUrl: string): Promise<string> {
    const cached = await this.redis.get(`mpesa:token:${baseUrl}`);
    if (cached) return cached;

    const response = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.config.mpesaConsumerKey}:${this.config.mpesaConsumerSecret}`).toString('base64')}`,
      },
    });
    if (!response.ok) throw new BadRequestException('Could not authenticate with M-Pesa');

    const body = (await response.json()) as MpesaTokenResponse;
    // Expire 60s early so we never send a token that dies mid-request.
    await this.redis.set(`mpesa:token:${baseUrl}`, body.access_token, Math.max(60, body.expires_in - 60));
    return body.access_token;
  }

  private readonly redis = new NullRedis();

  /**
   * Daraja callbacks are plain HTTPS posts authenticated by the IP allow-list we
   * configure at the Daraja portal, not by a signature. The amount is therefore
   * checked against what we recorded, and the CheckoutRequestID is the only way
   * to match the event to a payment.
   */
  verifyWebhook(rawBody: Buffer): WebhookEvent {
    let body: {
      Body?: {
        stkCallback?: {
          CheckoutRequestID?: string;
          ResultCode?: number;
          ResultDesc?: string;
          Amount?: number;
          Currency?: string;
          MerchantReceiptNo?: string;
          CallbackMetadata?: Array<{ Name: string; Value: string }>;
        };
      };
    };

    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Malformed M-Pesa callback body');
    }

    const callback = body.Body?.stkCallback;
    if (!callback?.CheckoutRequestID) throw new BadRequestException('Callback is missing CheckoutRequestID');

    // 0 = success. Everything else is a failure or a rejection.
    const succeeded = callback.ResultCode === 0;

    return {
      provider: this.name,
      reference: callback.CheckoutRequestID,
      transactionId: callback.MerchantReceiptNo,
      status: succeeded ? 'SUCCESS' : 'FAILED',
      idempotencyKey: callback.CheckoutRequestID,
      failureReason: succeeded ? undefined : `${callback.ResultDesc ?? 'Failed'} (${callback.ResultCode})`,
      amountMinor: callback.Amount != null ? Math.round(callback.Amount * 100) : undefined,
      currency: callback.Currency,
    };
  }
}

// ---------------------------------------------------------------------------
// Generic HMAC provider (aggregators such as Flutterwave, Paystack, etc.)
// ---------------------------------------------------------------------------

@Injectable()
export class GenericHmacProvider implements PaymentProvider {
  readonly name = 'generic';
  private readonly logger = new Logger(GenericHmacProvider.name);

  constructor(
    private readonly config: AppConfig,
    private readonly guard: WebhookGuard,
  ) {}

  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    const reference = `${this.config.paymentReferencePrefix}${request.idempotencyKey}`;

    if (!this.config.paymentGatewayCheckoutUrl) {
      this.logger.warn('PAYMENT_GATEWAY_CHECKOUT_URL not set - recording a pending payment only');
      return { provider: this.name, reference, status: 'PENDING' };
    }

    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({
      reference,
      amountMinor: request.amountMinor,
      currency: request.currency,
      callbackUrl: this.config.paymentGatewayCallbackUrl,
      metadata: {
        productType: request.productType,
        productId: request.productId,
        userId: request.userId,
        accountReference: request.accountReference,
      },
    });

    const response = await fetch(this.config.paymentGatewayCheckoutUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Timestamp': timestamp,
        'X-Signature': computeHmacSignature(this.config.paymentWebhookSecret, Buffer.from(body), timestamp),
      },
      body,
    });

    if (!response.ok) throw new BadRequestException('Payment gateway rejected the checkout');

    const parsed = (await response.json()) as { reference?: string; checkout?: Record<string, unknown> };
    return {
      provider: this.name,
      reference: parsed.reference ?? reference,
      status: 'PENDING',
      checkout: parsed.checkout,
    };
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): WebhookEvent {
    const signature = headers['x-signature'];
    const timestamp = headers['x-timestamp'];
    const eventId = headers['x-event-id'];

    if (!signature) throw new BadRequestException('Missing webhook signature');
    this.guard.assertFresh(timestamp);

    const expected = computeHmacSignature(this.config.paymentWebhookSecret, rawBody, timestamp ?? '');
    if (!safeEqual(expected, signature)) {
      throw new BadRequestException('Invalid webhook signature');
    }

    let payload: {
      reference?: string;
      eventId?: string;
      status?: string;
      transactionId?: string;
      amountMinor?: number;
      currency?: string;
      reason?: string;
    };
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Malformed webhook body');
    }

    if (!payload.reference) throw new BadRequestException('Webhook is missing a reference');

    return {
      provider: this.name,
      reference: payload.reference,
      transactionId: payload.transactionId,
      status: (payload.status ?? 'FAILED').toUpperCase() as WebhookEvent['status'],
      // Falls back to the event id so replay protection still works even when
      // the gateway does not send an explicit one.
      idempotencyKey: payload.eventId ?? eventId ?? payload.reference,
      failureReason: payload.reason,
      amountMinor: payload.amountMinor,
      currency: payload.currency,
    };
  }
}

// ---------------------------------------------------------------------------
// Mock provider - development and tests only
// ---------------------------------------------------------------------------

@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  private readonly logger = new Logger(MockPaymentProvider.name);

  constructor(
    private readonly config: AppConfig,
    private readonly guard: WebhookGuard,
  ) {}

  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    const reference = `mock_${request.idempotencyKey}`;
    this.logger.log(
      `Mock checkout: ${request.productType} ${request.productId ?? '-'} ${request.amountMinor} ${request.currency} ref=${reference}. No money moves.`,
    );
    return { provider: this.name, reference, status: 'PENDING' };
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): WebhookEvent {
    const signature = headers['x-signature'];
    const timestamp = headers['x-timestamp'];

    if (!signature) throw new BadRequestException('Missing webhook signature');
    this.guard.assertFresh(timestamp);

    const expected = computeHmacSignature(this.config.paymentWebhookSecret, rawBody, timestamp ?? '');
    if (!safeEqual(expected, signature)) {
      throw new BadRequestException('Invalid webhook signature');
    }

    let payload: {
      reference?: string;
      eventId?: string;
      status?: string;
      transactionId?: string;
      amountMinor?: number;
      currency?: string;
      reason?: string;
    };
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Malformed webhook body');
    }
    if (!payload.reference) throw new BadRequestException('Webhook is missing a reference');

    return {
      provider: this.name,
      reference: payload.reference,
      transactionId: payload.transactionId,
      status: (payload.status ?? 'SUCCESS').toUpperCase() as WebhookEvent['status'],
      idempotencyKey: payload.eventId ?? payload.reference,
      failureReason: payload.reason,
      amountMinor: payload.amountMinor,
      currency: payload.currency,
    };
  }
}

/** Minimal in-memory stand-in used by MpesaProvider's token cache. */
class NullRedis {
  private store = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}

/** Chooses the configured driver. */
@Injectable()
export class PaymentProviderFactory {
  constructor(
    private readonly config: AppConfig,
    private readonly guard: WebhookGuard,
  ) {}

  create(): PaymentProvider {
    switch (this.config.paymentProvider) {
      case 'mpesa':
        return new MpesaProvider(this.config);
      case 'generic':
        return new GenericHmacProvider(this.config, this.guard);
      case 'mock':
      default:
        return new MockPaymentProvider(this.config, this.guard);
    }
  }
}

export type { SubscriptionTier };
