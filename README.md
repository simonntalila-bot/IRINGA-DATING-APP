# Iringa Dating

Location-aware **18+ dating** app for Iringa city, its villages and the
surrounding areas of Iringa, Tanzania. Built as a monorepo: NestJS API +
PostgreSQL/Redis + React Native client.

Monetisation: **contact unlock TZS 1,000**, **premium video TZS 1,000**,
subscriptions and boosts. Every paid feature is granted by a verified payment
webhook, and every disclosure is gated on the profile owner's own consent.

Three rules that shaped every decision:

1. **Geography is data, not code.** Iringa's areas, villages, streets and dating
   places live in the database and are managed from the admin API. Nothing about
   Iringa is hard-coded, so a new ward or venue needs no code change and no new
   APK.
2. **A user's exact position is never exposed.** Others only ever see an
   approximate area name and, when *both* people opted in, a rounded distance.
   Live location is a separate, expiring, revocable grant - never a purchase.
3. **A payment buys access to an approved feature, never a person.** If the
   owner disables contact sharing, access stops immediately even though the
   payment succeeded. The product may not be used to advertise or sell sexual
   services; that is enforced through content policy, report reasons and
   moderation.

---

## Stack

| Layer | Choice |
| --- | --- |
| Mobile | React Native 0.76 + TypeScript, React Navigation, TanStack Query, Zustand, Socket.IO, FCM, Google Maps, Keychain |
| API | NestJS 11 + TypeScript, REST + WebSocket gateway, JWT access/rotating refresh, Throttler, Helmet |
| Data | PostgreSQL 16 + Prisma 6, Redis 7 (cache/presence/typing/rate limits) |
| Media | Cloudflare R2 (S3-compatible) with presigned URLs, local-disk driver for development |
| Payments | Provider abstraction (`PaymentProvider` + mock driver) + `EntitlementService` authorisation layer |

---

## Monetisation flow

```
User taps "Get contact"  ->  GET  /contact/unlock/:userId/quote      (price comes from the server)
                         ->  POST /contact/unlock/:userId            (creates a PENDING payment)
Gateway confirms         ->  POST /payments/webhook  (HMAC verified, idempotent)
Backend delivers         ->  ContactUnlock + Entitlement rows created in one transaction
User sees contact        ->  GET  /contact/card/:userId              (only if entitled AND consented)
```

Guarantees enforced server side:

| Rule | How |
| --- | --- |
| One payment = one target profile | `@@unique([buyerId, profileOwnerId])` on `ContactUnlock` |
| Already unlocked is never charged again | the service refuses before creating a payment, and the index blocks a race |
| Failed payment grants nothing | only `SUCCESS` reaches `deliverPayment` |
| Same webhook twice grants once | `paymentItem.deliveredAt` guard + upserts on entitlement keys |
| A payment never overrides consent | `EntitlementService.canViewPhone` also checks the owner's live flag |
| Blocked users lose everything | every `can*` method checks block state first |
| Admins cannot casually browse numbers | SUPER_ADMIN/ADMIN + a written reason, every read written to `sensitive_access_logs` |

Phone numbers are stored **encrypted**: AES-256-GCM ciphertext with a keyed HMAC
index for lookups. The database never holds a readable contact number.

---

## Requirements

- Node.js 20+
- Docker Desktop (for the local PostgreSQL and Redis)
- Android Studio + Android SDK for the mobile app (or Xcode for iOS)

---

## 1. Start the infrastructure

```bash
npm run db:up          # postgres on :5432, redis on :6379
```

## 2. Backend

```bash
cd backend
cp .env.example .env
# generate real secrets:
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log('JWT_REFRESH_SECRET=' + require('crypto').randomBytes(48).toString('hex'))"
# paste them into .env

npm run prisma:generate   # generate the Prisma client
npm run prisma:migrate    # create the schema
npm run prisma:seed       # Iringa region + categories + interests + dev accounts
npm run start:dev         # http://localhost:4000/api/v1
```

Check it is alive:

```bash
curl http://localhost:4000/api/v1/health
```

### What the seed does and does not do

- Seeds the **administrative hierarchy only**: Iringa Region, Iringa District,
  Iringa Municipal Council, with coordinates explicitly marked as approximate.
- Seeds **place categories** (restaurants, cafes, hotels, events, dating spotsâ€¦).
- Seeds **no venues**. No Iringa business is invented. Add real, verified places
  from the admin API, then add areas/villages/streets under them.
- Seeds three clearly labelled development accounts (phones `+255700000001..3`,
  password `DevOnly_12345`) and an admin (`ADMIN_EMAIL`/`ADMIN_PASSWORD`).

### Media storage without Cloudflare

If `R2_*` is empty the API uses a local disk driver, so the full upload flow
works offline: the client uploads to a signed local endpoint, the server sniffs
the binary header, stores the file under `backend/uploads/` and serves it through
a short-lived HMAC-signed URL. Switch to R2 by filling in `R2_*` - no code
change.

### Push notifications without Firebase

Without `FCM_SERVICE_ACCOUNT_PATH` the push transport logs instead of sending.
Notifications are still persisted in PostgreSQL, so the in-app list is complete.

### Payments

`PAYMENT_PROVIDER=mock` implements the `PaymentProvider` interface. Real gateway
logic goes in a new class and nothing else in the codebase changes.

---

## 3. Mobile app

`mobile/` installs on its own - it is deliberately **not** an npm workspace.
React Native's Android build resolves `mobile/node_modules/react-native` by
literal path, and hoisting it to the repository root breaks `gradlew`.

```bash
cd mobile
npm install
npm start          # Metro
npm run android    # or: npm run ios
```

The client points at the ngrok tunnel by default (see `mobile/src/config.ts`).
For an emulator on the same machine use `http://10.0.2.2:4000/api/v1`. Override
either way by setting `globalThis.__IRINGA_CONFIG__` before the app module loads.

### Building the release APK

```bash
npm run apk          # from the repository root
```

The output is `mobile/android/app/build/outputs/apk/release/app-release.apk` -
a standalone APK that does **not** need Metro running, so it can be sideloaded
onto a real phone.

Prerequisites on this machine:

| Requirement | Why |
| --- | --- |
| `JAVA_HOME` = Android Studio's JBR | Gradle |
| `ANDROID_HOME` = the SDK | Gradle |
| `GRADLE_USER_HOME` = `D:\gradle-home` | C: does not have room for the cache |
| `JAVA_HOME` and `ANDROID_HOME` set in `mobile/../build-apk.cmd` | see the notes below |

Signing credentials live in `mobile/android/keystore.properties`, which is
git-ignored. Without that file the release build falls back to the debug key,
which must never be distributed.

> **Windows path length.** The Desktop path
> `C:\Users\HomePC\Desktop\DATING  APP IN IRINGA  TU\...` is long enough that
> `ninja` fails with `mkdir ...: No such file or directory` while compiling
> react-native-reanimated's C++. The limit is 260 characters and Long Paths is
> already enabled, but `ninja` is not long-path aware. Build from a short path
> such as `D:\ir\mobile` (this is what the current `build-apk.cmd` does).

> **Pinned versions.** `react-native` is fixed at 0.76.5, so every native
> library is pinned to an exact version from the same era. A caret range resolves
> to releases that need React Native 0.78+ and fail at codegen time -
> react-native-screens 4.28 and react-native-reanimated 3.19 both do.

### Deep links

`https://<domain>/p/:handle`, `/place/:id`, `/story/:id`, `/post/:id`,
`/invite/:code`. For Android App Links and iOS Universal Links, serve
`/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association`
listing the **release** keystore fingerprint
(`c:ec:d2:73:0f:cb:92:d0:93:4b:b7:d4:b1:5c:90:c2:00:53:28:3f:b8:ea:e3:17:c9:54:a3:b4:98:20:98:82`
- SHA-256 of the `iringa` key). Until the app is listed, the link opens the web
page, the user installs the app, and React Navigation replays the original
destination after sign-in (deferred deep link).

---

## 4. Quality gates

```bash
npm run typecheck   # tsc --noEmit in both workspaces
npm run test        # jest, 99 unit tests
npm run lint        # eslint + prettier
```

What the unit tests cover (no database required):

- haversine distance, point-in-polygon, geofence radius, bounding boxes,
  coarse distance labels
- the entire privacy rule set: area-only by default, distance only for matches
  with mutual consent, nothing when blocked, nothing when `HIDDEN`, and a guard
  that fails a payload containing `latitude`/`longitude`/`gps`
- compatibility scoring and its admin-tunable weights
- the 18+ rule and the block/hide policy
- **business rules**: TZS 1,000 pricing, no double charge, consent beating a
  payment, the payment state machine (only `SUCCESS` grants), webhook
  idempotency, live-location windows, and encryption at rest including tamper
  detection

Anything that needs PostgreSQL is exercised by running the app against the
docker-compose database; no test in this repository silently mocks the database.

---

## Running it yourself

```bash
# 1. database (either Docker or your own local PostgreSQL)
npm run db:up

# 2. API
cd backend
cp .env.example .env
#   set DATABASE_URL to YOUR postgres, and paste in the three generated secrets:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
npm run prisma:migrate && npm run prisma:seed
npm run start:dev

# 3. from the repo root, in another terminal:
node scripts/demo.mjs
```

`scripts/demo.mjs` walks the entire flow against the live server and prints the
real responses: registration and the 18+ refusal, OTP single-use, Iringa area
detection, discovery, a match, the TZS 1,000 quote, a **rejected** unsigned
webhook, a signed webhook that grants access, a **replayed** webhook that does
not, the contact card appearing, and then the owner revoking consent so the
number disappears again. It needs no arguments and no mobile device.

## See the mobile UI

The React Native app needs the Android emulator (or a device), which cannot run
inside this environment. Generate the native projects once:

```bash
cd mobile
npx @react-native-community/cli@15.0.1 init IringaDating --version 0.76.5
npm install
npm run android
```

Point `globalThis.__IRINGA_CONFIG__` at your API host (see `mobile/src/config.ts`);
`10.0.2.2` already works for the standard Android emulator.

## Repository layout

```
backend/
  prisma/schema.prisma     users, profiles, likes, matches, chat, stories,
                           posts, dates, subscriptions, boosts, reports,
                           verifications, admin, and the Iringa geography:
                           supported_regions, location_nodes (self-referencing
                           district -> municipality -> ward -> area -> village
                           -> street), location_places, geofences
  prisma/seed.ts           development seed (no invented places)
  src/
    auth/                  register, OTP, login, rotating refresh, 18+ gate
    users/                 block/hide policy + location privacy preferences
    profiles/              profile CRUD, public view with privacy applied
    media/                 R2/local storage, presigned upload + read, MIME sniff
    locations/             Iringa boundary check, area resolution, places
    geofencing/            throttled location reports, geofence events,
                           consent-gated "your match is around X" alerts
    discovery/             filters, compatibility score, swipes, matches, undo
    matches/               match list, unmatch, read receipts
    chat/                  REST + Socket.IO gateway, typing, presence, media
    stories/ posts/ dates/ subscriptions/ verification/ reports/
    admin/                 RBAC, location management, moderation, audit log
    common/                config, prisma, redis, guards, filters, geo utils
  test/                    unit tests for geo, privacy, compatibility, blocks
mobile/
  src/api/                 axios client with rotating refresh + endpoint map
  src/navigation/          auth stack and main tabs
  src/screens/             age gate, auth, OTP, location, profile setup,
                           discover, matches, chat, map, privacy
  src/location/            geolocation with battery-conscious policy
  src/store/               auth + settings stores
docs/API.md                endpoint reference
```

---

## Taking payments for real

`PAYMENT_PROVIDER` selects the driver; nothing else in the codebase changes.

| Driver | What it does |
| --- | --- |
| `mock` | Development/tests. HMAC-signed webhooks, no money moves. |
| `mpesa` | **Safaricom Daraja.** STK push: the payer approves on their phone. `CheckoutRequestID` becomes `providerRef` so the callback matches the payment. |
| `generic` | Any aggregator that accepts an HMAC-signed request and posts an HMAC-signed callback. |

Configure M-Pesa in `.env`:

```
PAYMENT_PROVIDER=mpesa
MPESA_BASE_URL=https://api.safaricom.co.ke     # sandbox: sandbox.safaricom.co.ke
MPESA_CONSUMER_KEY=...  MPESA_CONSUMER_SECRET=...
MPESA_SHORTCODE=...     MPESA_PASSCODE=...
MPESA_CALLBACK_URL=https://api.example.com/api/v1/payments/webhook
```

The payer phone is decrypted from the database **only** at the moment it is sent
to the gateway, and is never written to the payment row.

Every webhook goes through four checks before anything is granted:

1. signature verified by the provider (HMAC over `timestamp.body`, or the Daraja
   IP allow-list);
2. timestamp freshness inside a 300 second window, plus single-use event ids, so
   a captured payload cannot be replayed;
3. **amount match** - if the gateway reports a different amount than we recorded,
   the payment is marked FAILED and nothing is granted;
4. only `SUCCESS` reaches the delivery path.

`GET /payments/provider` reports which driver is live and whether its credentials
are actually configured, so a misconfigured deployment is visible instead of
silently collecting nothing.

## Calls (WebRTC signalling)

Media is peer-to-peer; **no audio or video touches our servers**, which also
means no call-recording consent is needed. The server only relays the SDP
offer/answer and ICE candidates, and keeps an audit trail of who called whom.

A call requires all three of: an active match, the callee's `allowCalls`
consent, and a valid contact entitlement. `GET /calls/permissions/:userId`
returns the exact reason so the UI can explain itself. A block ends an in-flight
call immediately and prevents new ones.

Socket events: `call:invite`, `call:incoming`, `call:accept`, `call:accepted`,
`call:reject`, `call:hangup`, `call:candidate`, `call:pending-candidates`,
`call:ended`, `call:state`.

> The native WebRTC module (`react-native-webrtc`) is **not** included, because
> this repository has no `android/`/`ios/` folders. The mobile screens implement
> the signalling contract; add the native module when you generate the native
> projects.

---

## Adding Iringa places and areas (admin)

```bash
# 1. Sign in as an admin, then create an area (a village or ward)
curl -X POST http://localhost:4000/api/v1/admin/locations \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"kind":"AREA","name":"Kihesa","centerLat":-7.7,"centerLng":35.2,"radiusM":1500}'

# 2. Add a real, verified venue
curl -X POST http://localhost:4000/api/v1/admin/places \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"categorySlug":"RESTAURANT","name":"Real place name","latitude":-7.77,
       "longitude":35.23,"isDatingFriendly":true,"isVerified":true,
       "sourceNote":"verified on <date>"}'
```

Creating a place automatically creates its geofence, which is what powers the
"you are near X" alert - and that alert only fires if the user turned it on.

---

## Security notes

- Secrets live in environment variables only. Nothing sensitive is in the mobile
  bundle; R2 credentials and payment keys never leave the server.
- Refresh tokens rotate. Reusing an already-rotated token revokes the whole
  token family and forces a fresh sign-in.
- OTP codes are stored hashed, single use, rate limited per target and expire in
  five minutes.
- Media uploads are size limited per type, MIME-checked *and* content-sniffed.
- Every chat operation re-checks conversation membership and match state; a block
  immediately stops messaging and hides location information.
- The admin API is separate, role-gated (`SUPER_ADMIN`, `ADMIN`, `MODERATOR`,
  `SUPPORT`) and every location or moderation change is written to `admin_logs`.

## Known gaps

Honest list of what is **not** finished yet:

- The iOS project is still not in this repository; only `android/` was
  generated. Building for iOS still needs `npx @react-native-community/cli@15.0.1
  init` on macOS plus CocoaPods.
- The new React Native architecture is **off** (`newArchEnabled=false` in
  `mobile/android/gradle.properties`). react-native-reanimated compiles its own
  C++ regardless, but Fabric/TurboModules are not in use.
- The M-Pesa (Daraja) and generic HMAC drivers are implemented, but no real
  credentials are committed so they have not been exercised against a live
  gateway here. Test against the Daraja sandbox first.
- The native WebRTC module is not included (there are no `android/`/`ios/`
  folders), so calls cannot be placed end to end yet - only the signalling.
- Selfie verification uses a placeholder verifier - wire a real liveness provider
  before shipping a verified badge.
- Voice recording/playback UI, GIFs, stickers, pinned messages and disappearing
  messages are not built.
- Admin has a complete **API** but no web dashboard UI.
- No end-to-end test suite against a live database; the unit tests cover
  privacy, geo, scoring, blocks and the business rules only.
- Push notification preferences are not yet per-category.
- Smart scam/fake-profile detection and profanity filtering are not implemented.
