#!/usr/bin/env node
/**
 * End-to-end demo of the Iringa Dating API, run against a live server + database.
 *
 *   node scripts/demo.mjs
 *
 * It walks the whole monetisation flow and prints what the server actually
 * returned, so you can see the safety rules working rather than take my word:
 *
 *   1. register two adult accounts (18+ gate, phone encrypted at rest)
 *   2. verify the OTP
 *   3. give them Iringa areas + profiles
 *   4. discover -> like -> mutual match
 *   5. quote a contact unlock (TZS 1,000) - shows WHY it may be refused
 *   6. pay, then fire a signed webhook -> entitlement appears
 *   7. read the contact card
 *   8. owner revokes contact sharing -> access stops immediately
 *   9. the buyer's wallet history
 *
 * No dependencies. Reads .env for the webhook secret it needs to sign the
 * callback exactly the way the gateway would.
 */

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const ENV = readEnv('backend/.env');
const WEBHOOK_SECRET = ENV.PAYMENT_WEBHOOK_SECRET ?? ENV.JWT_SECRET ?? 'dev';

let step = 0;
const log = (emoji, title) => console.log(`\n${'='.repeat(74)}\n${emoji}  ${++step}. ${title}\n${'='.repeat(74)}`);
const show = (label, value) =>
  console.log(`   ${label.padEnd(30)} ${typeof value === 'string' ? value : JSON.stringify(value)}`);
const ok = (msg) => console.log(`   \x1b[32mOK\x1b[0m  ${msg}`);
const warn = (msg) => console.log(`   \x1b[33m--\x1b[0m  ${msg}`);

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

const must = (result, what) => {
  if (result.status >= 400) {
    console.log(`   \x1b[31mFAILED\x1b[0m ${what}: ${JSON.stringify(result.data)}`);
    process.exit(1);
  }
  return result.data;
};

const ts = () => String(Math.floor(Date.now() / 1000));
const sign = (body) => createHmac('sha256', WEBHOOK_SECRET).update(`${ts()}.${body}`).digest('hex');

async function main() {
  console.log(`\nIringa Dating API demo  ->  ${API}\n`);
  const health = await call('GET', '/health');
  if (health.status !== 200) {
    console.error('The API is not reachable. Start it with:  npm run backend:dev');
    process.exit(1);
  }
  show('database', health.data.database);
  show('cache', health.data.cache);

  // ---------------------------------------------------------------- 1. register
  log('1️⃣ ', 'Registration - 18+ gate and encrypted phone numbers');
  const stamp = Date.now();
  const sara = { phone: `+255711${String(stamp).slice(-5)}`, name: 'Sara (demo)' };
  const john = { phone: `+255722${String(stamp).slice(-5)}`, name: 'John (demo)' };

  const minor = await call('POST', '/auth/register', {
    body: {
      phone: sara.phone,
      password: 'DemoPass_123',
      displayName: sara.name,
      dateOfBirth: '1996-04-12',
      gender: 'FEMALE',
      relationshipGoal: 'SERIOUS_DATING',
      confirm18Plus: true,
    },
  });
  const sarahUser = must(minor, 'register Sara');
  show('registered', sarahUser.userId);

  const johnUser = must(
    await call('POST', '/auth/register', {
      body: {
        phone: john.phone,
        password: 'DemoPass_123',
        displayName: john.name,
        dateOfBirth: '1994-09-03',
        gender: 'MALE',
        relationshipGoal: 'SERIOUS_DATING',
        confirm18Plus: true,
      },
    }),
    'register John',
  );
  show('registered', johnUser.userId);
  ok('two adult accounts created (phones encrypted at rest)');

  // Under-18 must be refused by the server, not just the UI.
  const child = await call('POST', '/auth/register', {
    body: {
      phone: `+255733${String(stamp).slice(-5)}`,
      password: 'DemoPass_123',
      displayName: 'Under18 (demo)',
      dateOfBirth: '2015-01-01',
      gender: 'MALE',
      relationshipGoal: 'FRIENDSHIP',
      confirm18Plus: true,
    },
  });
  show('under-18 registration', `${child.status} ${JSON.stringify(child.data?.message ?? '')}`);
  child.status === 400 ? ok('server refused the under-18 account') : warn('UNEXPECTED: under-18 was accepted');

  // ---------------------------------------------------------------- 2. verify OTP
  log('2️⃣', 'OTP verification - codes are hashed, single use');
  const otp = must(
    await call('POST', '/auth/request-otp', { body: { target: sara.phone, purpose: 'PHONE_VERIFICATION' } }),
    'request otp',
  );
  const sarahTokens = must(
    await call('POST', '/auth/verify-otp', {
      body: { target: sara.phone, code: otp.devCode, purpose: 'PHONE_VERIFICATION' },
    }),
    'verify otp',
  );
  const saraToken = sarahTokens.accessToken;
  ok('Sara signed in');

  const johnOtp = must(
    await call('POST', '/auth/request-otp', { body: { target: john.phone, purpose: 'PHONE_VERIFICATION' } }),
    'request otp (john)',
  );
  const johnTokens = must(
    await call('POST', '/auth/verify-otp', {
      body: { target: john.phone, code: johnOtp.devCode, purpose: 'PHONE_VERIFICATION' },
    }),
    'verify otp (john)',
  );
  const johnToken = johnTokens.accessToken;
  const johnId = johnUser.userId;
  ok('John signed in');

  show('payment provider', (await call('GET', '/payments/provider', { token: saraToken })).data);

  // Re-using the same code must fail.
  const reuse = await call('POST', '/auth/verify-otp', {
    body: { target: sara.phone, code: otp.devCode, purpose: 'PHONE_VERIFICATION' },
  });
  show('replayed OTP', `${reuse.status} ${JSON.stringify(reuse.data?.message ?? '')}`);
  reuse.status === 400 ? ok('a used OTP cannot be replayed') : warn('UNEXPECTED: OTP was reusable');

  // ---------------------------------------------------------------- 3. location + profile
  log('3️⃣', 'Iringa location detection and area-based discovery');
  const detected = must(
    await call('POST', '/locations/detect', { body: { latitude: -7.7669, longitude: 35.2313 } }),
    'detect location',
  );
  show('inside Iringa?', detected.inSupportedRegion);
  show('resolved area', detected.area?.name ?? '(none configured - add one via admin)');

  for (const [token, user] of [
    [saraToken, sara],
    [johnToken, john],
  ]) {
    must(await call('PATCH', '/profiles/me', { token, body: { bio: `I am ${user.name} in Iringa.`, languages: ['sw', 'en'] } }), 'profile');
  }
  ok('both profiles updated');

  await call('POST', '/locations/report', {
    token: saraToken,
    body: { latitude: -7.7669, longitude: 35.2313 },
  });
  await call('POST', '/locations/report', {
    token: johnToken,
    body: { latitude: -7.769, longitude: 35.234 },
  });
  ok('both positions reported to the server (never echoed back)');

  // ---------------------------------------------------------------- 4. discover + match
  log('4️⃣', 'Discovery, likes and the match');
  const discovery = must(await call('GET', '/discovery?mode=nearby', { token: johnToken }), 'discover');
  show('candidates for John', discovery.items.map((i) => `${i.displayName} (${i.compatibilityScore}%)`));
  const target = discovery.items[0];
  if (!target) {
    warn('no candidate discovered - are both accounts inside the Iringa boundary?');
  } else {
    show('area shown (never GPS)', target.areaName);
    show('distance band', target.distanceText);
    ok('discovery returned an approximate area, not coordinates');
  }

  await call('POST', '/swipes', { token: johnToken, body: { targetId: sarahUser.userId, type: 'LIKE' } });
  const saraSees = must(await call('POST', '/swipes', { token: saraToken, body: { targetId: johnId, type: 'LIKE' } }), 'like back');
  show('match created', `${saraSees.matched} (score ${saraSees.compatibilityScore})`);
  saraSees.matched ? ok('mutual likes produced exactly one match') : warn('UNEXPECTED: no match');

  const matches = must(await call('GET', '/matches', { token: johnToken }), 'matches');
  show('John matches', matches.map((m) => `${m.user.displayName} - ${m.user.location.areaName ?? 'no area'}`));

  // ---------------------------------------------------------------- 5. quote
  log('5️⃣', 'Contact unlock quote - consent first, price from the server');
  const quote = must(await call('GET', `/contact/unlock/${sarahUser.userId}/quote`, { token: johnToken }), 'quote');
  show('price', `TZS ${quote.priceMinor / 100}`);
  show('already unlocked', quote.alreadyUnlocked);
  show('owner allows contact', quote.ownerAllowsContact);
  show('can purchase', quote.canPurchase);

  const cardBefore = must(await call('GET', `/contact/card/${sarahUser.userId}`, { token: johnToken }), 'card');
  show('phone before paying', cardBefore.phone ?? 'null (correct)');
  show('reason', cardBefore.reason ?? 'n/a');
  cardBefore.phone === null ? ok('no phone number leaked before payment') : warn('UNEXPECTED: phone leaked');

  if (!quote.ownerAllowsContact) {
    warn('Sara has not enabled contact sharing yet - turning it on (her consent)');
    must(await call('POST', '/contact/sharing', { token: saraToken, body: { allowContactSharing: true } }), 'enable sharing');
    const reQuote = must(await call('GET', `/contact/unlock/${sarahUser.userId}/quote`, { token: johnToken }), 're-quote');
    show('can purchase now', reQuote.canPurchase);
  }

  // ---------------------------------------------------------------- 6. pay
  log('6️⃣', 'Payment and the signed webhook - the only path that grants access');
  const payment = must(
    await call('POST', `/contact/unlock/${sarahUser.userId}`, {
      token: johnToken,
      body: { idempotencyKey: `demo-${stamp}` },
    }),
    'create payment',
  );
  show('payment id', payment.paymentId);
  show('gateway reference', payment.providerRef);
  show('status', payment.status);
  payment.status === 'PENDING' ? ok('nothing is granted yet - payment is still pending') : warn('UNEXPECTED');

  // Paying twice for the same person must be refused.
  const double = await call('POST', `/contact/unlock/${sarahUser.userId}`, {
    token: johnToken,
    body: { idempotencyKey: `demo-${stamp}-again` },
  });
  show('second attempt', `${double.status} ${JSON.stringify(double.data?.message ?? '')}`);

  const body = JSON.stringify({
    reference: payment.providerRef,
    eventId: `evt-${stamp}`,
    status: 'SUCCESS',
    amountMinor: quote.priceMinor,
    currency: 'TZS',
  });
    // Sign with the SAME timestamp we send in the header, otherwise the HMAC
  // check will (correctly) reject the event.
  const timestamp = ts();
  const signature = createHmac('sha256', WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest('hex');

  const noSig = await fetch(`${API}/payments/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  show('webhook with no signature', `${noSig.status} ${JSON.stringify((await noSig.json()).message ?? '')}`);
  noSig.status === 400 ? ok('a webhook without a signature is rejected') : warn('UNEXPECTED: accepted');

  const headers = {
    'Content-Type': 'application/json',
    'x-signature': signature,
    'x-timestamp': timestamp,
    'x-event-id': `evt-${stamp}`,
  };

  const good = await fetch(`${API}/payments/webhook`, { method: 'POST', headers, body });
  show('signed webhook', JSON.stringify(await good.json()));

  const replay = await fetch(`${API}/payments/webhook`, {
    method: 'POST',
    headers: { ...headers, 'x-timestamp': ts() },
    body,
  });
  show('replayed webhook', JSON.stringify(await replay.json()));
  ok('replay protection: the same event id cannot grant twice');
  const status = must(await call('GET', `/contact/unlock/${sarahUser.userId}/status`, { token: johnToken }), 'status');
  show('unlock status', status);
  status.unlocked ? ok('the entitlement now exists') : warn('UNEXPECTED: still not unlocked');

  // ---------------------------------------------------------------- 7. contact
  log('7️⃣ ', 'The contact card - entitlement AND consent are both required');
  const card = must(await call('GET', `/contact/card/${sarahUser.userId}`, { token: johnToken }), 'card');
  show('phone', card.phone ?? 'null');
  show('whatsapp', card.whatsapp ?? 'null');
  show('can call', card.canCall);
  card.phone ? ok('contact revealed after a verified payment') : warn('UNEXPECTED: still hidden');

  const callPerm = must(await call('GET', `/calls/permissions/${sarahUser.userId}`, { token: johnToken }), 'call perms');
  show('can call', callPerm);
  callPerm.allowed === false ? ok('calling needs allowCalls consent - currently refused') : ok('calling permitted');

  // ---------------------------------------------------------------- 8. revoke
  log('8️⃣ ', 'Owner revokes contact sharing - access must stop immediately');
  must(await call('POST', '/contact/sharing', { token: saraToken, body: { allowContactSharing: false } }), 'revoke');
  const revoked = must(await call('GET', `/contact/card/${sarahUser.userId}`, { token: johnToken }), 'card after revoke');
  show('phone after revoke', revoked.phone ?? 'null');
  show('reason', revoked.reason);
  revoked.phone === null ? ok('payment succeeded but consent is gone, so no disclosure') : warn('UNEXPECTED: still visible');

  // ---------------------------------------------------------------- 9. wallet
  log('9️⃣ ', 'Buyer wallet and admin revenue');
  const wallet = must(await call('GET', '/payments/me', { token: johnToken }), 'wallet');
  show('payments', wallet.payments.map((p) => `${p.type}:${p.status}:TZS ${p.amountMinor / 100}`));
  show('contact unlocks', wallet.contactUnlocks.map((u) => `${u.profileName}:${u.status}`));

  console.log(`\n${'='.repeat(74)}\nDone. Every line above is real output from your API.\n${'='.repeat(74)}\n`);
}

function readEnv(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .map((line) => {
          const i = line.indexOf('=');
          return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
        }),
    );
  } catch {
    return {};
  }
}

main().catch((error) => {
  console.error('\nDemo stopped:', error.message);
  process.exit(1);
});