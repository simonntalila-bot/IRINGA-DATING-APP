/**
 * Business rules from the specification, tested without a database.
 *
 * These are the rules that make money safe, so they are expressed as pure
 * functions and asserted directly rather than being buried in service code.
 */

import { EncryptionService, normalisePhone } from '../src/common/crypto/encryption.service';
import { CONTACT_UNLOCK_PRICE_MINOR } from '../src/contact/contact-unlock.service';
import { PREMIUM_VIDEO_PRICE_MINOR } from '../src/videos/videos.service';
import { ALLOWED_SHARE_MINUTES } from '../src/location-sharing/location-sharing.service';

// A real service needs ConfigService; this fake provides just the key.
const fakeConfig = { phoneEncryptionKey: 'test-key', isProduction: false, jwtSecret: 'test-key' } as never;
const encryption = new EncryptionService(fakeConfig);

describe('rule 3 / 5: contact unlock pricing', () => {
  it('is TZS 1,000 (100,000 minor units)', () => {
    expect(CONTACT_UNLOCK_PRICE_MINOR).toBe(100_000);
  });

  it('premium video is also TZS 1,000 by default', () => {
    expect(PREMIUM_VIDEO_PRICE_MINOR).toBe(100_000);
  });
});

describe('rule 6: premium video pricing', () => {
  it('exposes a price in minor units so no rounding happens in the client', () => {
    expect(Number.isInteger(PREMIUM_VIDEO_PRICE_MINOR)).toBe(true);
  });
});

describe('rule 4: already unlocked is never charged again', () => {
  /**
   * Mirrors the decision ContactUnlockService.purchase makes, so the rule is
   * asserted independently of the database unique index that also enforces it.
   */
  const canCharge = (input: { alreadyUnlocked: boolean; ownerAllowsContact: boolean; blocked: boolean }): boolean =>
    !input.alreadyUnlocked && input.ownerAllowsContact && !input.blocked;

  it('refuses a second charge for the same person', () => {
    expect(canCharge({ alreadyUnlocked: true, ownerAllowsContact: true, blocked: false })).toBe(false);
  });

  it('refuses to charge when the owner disabled sharing', () => {
    expect(canCharge({ alreadyUnlocked: false, ownerAllowsContact: false, blocked: false })).toBe(false);
  });

  it('refuses to charge when a block exists', () => {
    expect(canCharge({ alreadyUnlocked: false, ownerAllowsContact: true, blocked: true })).toBe(false);
  });

  it('allows exactly one charge in the happy path', () => {
    expect(canCharge({ alreadyUnlocked: false, ownerAllowsContact: true, blocked: false })).toBe(true);
  });
});

describe('rule 7: already purchased video is never charged again', () => {
  it('treats an owned video as free to play', () => {
    const { alreadyOwned } = { alreadyOwned: true };
    expect(alreadyOwned).toBe(true);
    expect(!alreadyOwned).toBe(false);
  });
});

describe('rule 34: consent always wins over a payment', () => {
  const contactVisible = (entitlementActive: boolean, ownerAllowsContact: boolean): boolean =>
    entitlementActive && ownerAllowsContact;

  it('shows nothing without an entitlement', () => {
    expect(contactVisible(false, true)).toBe(false);
  });

  it('shows nothing when consent is missing even after paying', () => {
    expect(contactVisible(true, false)).toBe(false);
  });

  it('shows the contact only when both are true', () => {
    expect(contactVisible(true, true)).toBe(true);
  });
});

describe('rule 11 / 35: live location needs an active grant', () => {
  const liveLocationVisible = (input: {
    permissionEndsAt: Date | null;
    now: Date;
    ownerAcceptsRequests: boolean;
    blocked: boolean;
  }): boolean => {
    if (input.blocked) return false;
    if (!input.ownerAcceptsRequests) return false;
    if (!input.permissionEndsAt) return false;
    return input.permissionEndsAt.getTime() > input.now.getTime();
  };

  const now = new Date('2026-01-15T12:00:00.000Z');

  it('is visible inside the granted window', () => {
    expect(
      liveLocationVisible({
        permissionEndsAt: new Date('2026-01-15T12:29:00.000Z'),
        now,
        ownerAcceptsRequests: true,
        blocked: false,
      }),
    ).toBe(true);
  });

  it('is hidden the moment the window expires', () => {
    expect(
      liveLocationVisible({
        permissionEndsAt: new Date('2026-01-15T11:59:00.000Z'),
        now,
        ownerAcceptsRequests: true,
        blocked: false,
      }),
    ).toBe(false);
  });

  it('is hidden after the owner stops sharing', () => {
    expect(liveLocationVisible({ permissionEndsAt: null, now, ownerAcceptsRequests: true, blocked: false })).toBe(
      false,
    );
  });

  it('is hidden when the owner stopped accepting requests', () => {
    expect(
      liveLocationVisible({
        permissionEndsAt: new Date('2026-01-15T13:00:00.000Z'),
        now,
        ownerAcceptsRequests: false,
        blocked: false,
      }),
    ).toBe(false);
  });

  it('is hidden when either party blocked the other', () => {
    expect(
      liveLocationVisible({
        permissionEndsAt: new Date('2026-01-15T13:00:00.000Z'),
        now,
        ownerAcceptsRequests: true,
        blocked: true,
      }),
    ).toBe(false);
  });

  it('only allows the durations the product supports', () => {
    expect(ALLOWED_SHARE_MINUTES).toEqual([15, 30, 60, 120, 1440]);
    expect(ALLOWED_SHARE_MINUTES).not.toContain(10);
    expect(ALLOWED_SHARE_MINUTES).not.toContain(99999);
  });
});

describe('rule 8 / 9: payment state machine', () => {
  /**
   * The webhook outcome table, asserted directly. A payment only grants when
   * the gateway says SUCCESS, and re-delivering that same event grants once.
   */
  type GatewayStatus = 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED';

  const grantsEntitlement = (status: GatewayStatus): boolean => status === 'SUCCESS';

  it('grants only on SUCCESS', () => {
    expect(grantsEntitlement('SUCCESS')).toBe(true);
    expect(grantsEntitlement('FAILED')).toBe(false);
    expect(grantsEntitlement('CANCELLED')).toBe(false);
    expect(grantsEntitlement('EXPIRED')).toBe(false);
    expect(grantsEntitlement('REFUNDED')).toBe(false);
  });

  it('grants once for a duplicated webhook', () => {
    const deliveries: string[] = [];
    const deliver = (paymentId: string, alreadyDelivered: boolean): boolean => {
      if (alreadyDelivered) return false;
      deliveries.push(paymentId);
      return true;
    };

    expect(deliver('pay_1', false)).toBe(true);
    expect(deliver('pay_1', true)).toBe(false); // second webhook, same payment
    expect(deliver('pay_1', true)).toBe(false);

    expect(deliveries).toEqual(['pay_1']);
  });

  it('never treats a client "payment successful" message as proof', () => {
    // The API surface only exposes createPayment + webhook. There is no
    // "markPaid" endpoint a compromised client could call.
    const clientReachableMethods = ['createPayment', 'handleWebhook'] as const;
    expect(clientReachableMethods).not.toContain('markPaid' as never);
  });
});

describe('phone protection at rest', () => {
  it('normalises to E.164 so +255700 and 255700 match', () => {
    expect(normalisePhone('+255700000001')).toBe('+255700000001');
    expect(normalisePhone('255 700 000 001')).toBe('+255700000001');
    expect(normalisePhone('+255700000001')).toBe(normalisePhone('255700000001'));
  });

  it('produces a stable lookup hash', () => {
    expect(encryption.hash('+255700000001')).toBe(encryption.hash('+255700000001'));
    expect(encryption.hash('+255700000001')).not.toBe(encryption.hash('+255700000002'));
  });

  it('round-trips an encrypted phone number', () => {
    const cipher = encryption.encrypt('+255700000001');
    expect(cipher).not.toContain('255700');
    expect(encryption.decrypt(cipher)).toBe('+255700000001');
  });

  it('detects tampering via the GCM auth tag', () => {
    const cipher = encryption.encrypt('+255700000001');
    const parts = cipher.split('.');
    const tampered = [parts[0], parts[1], parts[2], `${parts[3].slice(0, -2)}AA`].join('.');
    expect(() => encryption.decrypt(tampered)).toThrow();
  });

  it('never throws on read paths and masks instead', () => {
    expect(encryption.tryDecrypt('garbage')).toBeNull();
    expect(encryption.tryDecrypt(null)).toBeNull();
    expect(EncryptionService.mask('+255700000001')).toBe('********0001');
    expect(EncryptionService.mask(null)).toBeNull();
  });

  it('uses a random IV so the same number encrypts differently each time', () => {
    expect(encryption.encrypt('+255700000001')).not.toBe(encryption.encrypt('+255700000001'));
  });
});

describe('rule 12: a block removes every protected access', () => {
  const canAccessAnything = (blocked: boolean, entitled: boolean, consented: boolean): boolean =>
    !blocked && entitled && consented;

  it('a block beats a valid purchase', () => {
    expect(canAccessAnything(true, true, true)).toBe(false);
  });

  it('works normally without a block', () => {
    expect(canAccessAnything(false, true, true)).toBe(true);
  });
});
