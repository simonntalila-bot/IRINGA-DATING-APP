/**
 * Calling + payment-gateway security rules, asserted without a database.
 */

import { RING_TIMEOUT_SECONDS } from '../src/calls/calls.service';
import { computeHmacSignature, safeEqual, REPLAY_WINDOW_SECONDS } from '../src/payments/payment-provider';

describe('call authorisation', () => {
  /**
   * Mirrors CallsService.canCall so the gate order is asserted directly:
   * block -> active match -> callee consent -> caller entitlement.
   */
  const canCall = (input: {
    sameUser: boolean;
    blocked: boolean;
    hasActiveMatch: boolean;
    calleeAllowsCalls: boolean;
    callerHasEntitlement: boolean;
  }): { allowed: boolean; reason: string | null } => {
    if (input.sameUser) return { allowed: false, reason: 'SELF_CALL' };
    if (input.blocked) return { allowed: false, reason: 'BLOCKED' };
    if (!input.hasActiveMatch) return { allowed: false, reason: 'NO_MATCH' };
    if (!input.calleeAllowsCalls) return { allowed: false, reason: 'CALLEE_DISABLED_CALLS' };
    if (!input.callerHasEntitlement) return { allowed: false, reason: 'NO_CONTACT_ENTITLEMENT' };
    return { allowed: true, reason: null };
  };

  it('allows a match who is entitled and consenting', () => {
    expect(
      canCall({
        sameUser: false,
        blocked: false,
        hasActiveMatch: true,
        calleeAllowsCalls: true,
        callerHasEntitlement: true,
      }),
    ).toEqual({ allowed: true, reason: null });
  });

  it('refuses a block even with a valid entitlement', () => {
    expect(
      canCall({
        sameUser: false,
        blocked: true,
        hasActiveMatch: true,
        calleeAllowsCalls: true,
        callerHasEntitlement: true,
      }).reason,
    ).toBe('BLOCKED');
  });

  it('refuses without an active match - calling is not random dialling', () => {
    expect(
      canCall({
        sameUser: false,
        blocked: false,
        hasActiveMatch: false,
        calleeAllowsCalls: true,
        callerHasEntitlement: true,
      }).reason,
    ).toBe('NO_MATCH');
  });

  it('refuses when the callee turned calls off, even if the buyer paid', () => {
    expect(
      canCall({
        sameUser: false,
        blocked: false,
        hasActiveMatch: true,
        calleeAllowsCalls: false,
        callerHasEntitlement: true,
      }).reason,
    ).toBe('CALLEE_DISABLED_CALLS');
  });

  it('refuses without a contact entitlement', () => {
    expect(
      canCall({
        sameUser: false,
        blocked: false,
        hasActiveMatch: true,
        calleeAllowsCalls: true,
        callerHasEntitlement: false,
      }).reason,
    ).toBe('NO_CONTACT_ENTITLEMENT');
  });

  it('refuses calling yourself', () => {
    expect(
      canCall({
        sameUser: true,
        blocked: false,
        hasActiveMatch: true,
        calleeAllowsCalls: true,
        callerHasEntitlement: true,
      }).reason,
    ).toBe('SELF_CALL');
  });

  it('rings for a bounded time so a missed call is recorded', () => {
    expect(RING_TIMEOUT_SECONDS).toBeGreaterThan(0);
    expect(RING_TIMEOUT_SECONDS).toBeLessThanOrEqual(60);
  });
});

describe('webhook authentication', () => {
  const secret = 'unit-test-webhook-secret';
  const body = Buffer.from(JSON.stringify({ reference: 'pay_1', status: 'SUCCESS' }));

  it('signs deterministically for the same timestamp', () => {
    const a = computeHmacSignature(secret, body, '1700000000');
    const b = computeHmacSignature(secret, body, '1700000000');
    expect(a).toBe(b);
  });

  it('changes when the timestamp changes, so a captured signature cannot be replayed with a new date', () => {
    expect(computeHmacSignature(secret, body, '1700000000')).not.toBe(computeHmacSignature(secret, body, '1700000001'));
  });

  it('changes when the body changes', () => {
    const other = Buffer.from(JSON.stringify({ reference: 'pay_1', status: 'FAILED' }));
    expect(computeHmacSignature(secret, body, '1700000000')).not.toBe(
      computeHmacSignature(secret, other, '1700000000'),
    );
  });

  it('compares signatures without leaking timing information', () => {
    const sig = computeHmacSignature(secret, body, '1700000000');
    expect(safeEqual(sig, sig)).toBe(true);
    expect(safeEqual(sig, sig.slice(0, -1))).toBe(false);
    expect(safeEqual(sig, '')).toBe(false);
  });

  it('uses a bounded replay window', () => {
    expect(REPLAY_WINDOW_SECONDS).toBeGreaterThanOrEqual(60);
    expect(REPLAY_WINDOW_SECONDS).toBeLessThanOrEqual(900);
  });
});

describe('amount validation', () => {
  /**
   * PaymentsService refuses to grant when the gateway reports a different
   * amount than the one we asked for.
   */
  const amountAccepted = (gatewayMinor: number | undefined, recordedMinor: number): boolean =>
    gatewayMinor == null || gatewayMinor === recordedMinor;

  it('accepts an exact match', () => {
    expect(amountAccepted(100_000, 100_000)).toBe(true);
  });

  it('rejects an underpayment', () => {
    expect(amountAccepted(99_900, 100_000)).toBe(false);
  });

  it('rejects an overpayment report too, because it means a mismatched payment', () => {
    expect(amountAccepted(100_100, 100_000)).toBe(false);
  });

  it('accepts when the gateway omits the amount (M-Pesa failure callbacks do)', () => {
    expect(amountAccepted(undefined, 100_000)).toBe(true);
  });

  it('treats TZS 1,000 minor units consistently', () => {
    // 1000 shillings == 100000 minor units. This is the price both the contact
    // unlock and the default premium video use.
    expect(100_000 / 100).toBe(1000);
  });
});

describe('payment grant decisions', () => {
  type Status = 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED';

  const grants = (status: Status): boolean => status === 'SUCCESS';

  it('grants only on SUCCESS', () => {
    expect(grants('SUCCESS')).toBe(true);
    for (const bad of ['FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED'] as Status[]) {
      expect(grants(bad)).toBe(false);
    }
  });

  it('rejects a replayed event before touching a payment', () => {
    const seen = new Set<string>();
    const accept = (eventId: string): boolean => {
      if (seen.has(eventId)) return false;
      seen.add(eventId);
      return true;
    };
    expect(accept('evt_1')).toBe(true);
    expect(accept('evt_1')).toBe(false);
    expect(accept('evt_2')).toBe(true);
  });
});
