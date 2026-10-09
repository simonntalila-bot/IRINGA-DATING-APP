# API reference

Base URL: `http://localhost:4000/api/v1`

All protected routes need `Authorization: Bearer <accessToken>`.
Errors always look like:

```json
{ "statusCode": 400, "error": "BadRequest", "message": "...", "path": "...", "timestamp": "..." }
```

## Auth

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/register` | public | Create account (18+ enforced server side). Returns `otp` with a `devCode` outside production. |
| POST | `/auth/request-otp` | public | Send OTP for `PHONE_VERIFICATION` or `PASSWORD_RESET`. |
| POST | `/auth/verify-otp` | public | Consume OTP, return token pair (sign-up / sign-in). |
| POST | `/auth/login` | public | Token pair. `PHONE_NOT_VERIFIED` code when unverified. |
| POST | `/auth/refresh` | public | Rotate refresh token. Reuse revokes the family. |
| POST | `/auth/reset-password` | public | OTP + new password. Revokes all sessions. |
| POST | `/auth/logout` | user | Revoke this or all devices. |
| GET | `/auth/me` | user | Account summary. |

## Profiles

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET/PATCH | `/profiles/me` | user | Read/update own profile. |
| GET | `/profiles/interests` | user | Interest catalogue. |
| PUT | `/profiles/me/interests` | user | Replace interests (max 15). |
| POST | `/profiles/me/photos` | user | Attach uploaded image as profile photo. |
| DELETE | `/profiles/me/photos/:id` | user | Remove photo, reindex primary. |
| PUT | `/profiles/me/photos/order` | user | Reorder photos. |
| GET | `/profiles/:userId` | user | Public profile **with privacy applied**. |

`GET /profiles/:userId` returns `location` shaped as:

```json
{ "areaName": "Kihesa", "areaKind": "AREA", "distanceKm": 2.4,
  "distanceLabel": "CLOSE", "distanceText": "~2 km away", "exactLocationShared": false }
```

There is no `latitude`/`longitude` in this payload, ever.

## Locations (Iringa)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/locations/detect` | public | Boundary + area check (works pre-registration). |
| POST | `/locations/report` | user | Persist position, resolve area, evaluate geofences. Throttled server side. |
| POST | `/locations/manual-area` | user | Set area manually (denied-permission path). |
| GET | `/locations/areas` | public | Filter by `kind`, `search`. |
| GET | `/locations/areas/tree` | public | Full hierarchy. |
| GET | `/locations/place-categories` | public | Categories. |
| GET | `/locations/places` | public | `category`, `nodeId`, `latitude`, `longitude`, `radiusKm`, `datingFriendly`, `search`. |
| GET | `/locations/places/:idOrSlug` | public | Place detail. |
| GET | `/geofencing/my-location` | user | Own location state (**self only**). |
| GET | `/geofencing/history` | user | Own area-arrival history. |

`POST /locations/report` response:

```json
{ "accepted": true, "throttled": false, "inSupportedRegion": true,
  "area": { "nodeId": "...", "name": "Kihesa", "kind": "AREA" },
  "reason": null, "distanceText": "In the same area", "alerts": [] }
```

## Discovery, swipes, matches

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/discovery` | user | `mode`, `minAge`, `maxAge`, `maxDistanceKm`, `relationshipGoal`, `interests`, `verifiedOnly`, `onlineOnly`, `limit`, `cursor`. 503 `OUTSIDE_SUPPORTED_REGION` outside Iringa. |
| GET | `/discovery/likes-received` | user | Who liked you (Premium). |
| POST | `/discovery/undo` | user | Undo last swipe (refuses when matched). |
| POST | `/swipes` | user | `targetId`, `type`. Idempotent per pair. |
| POST | `/swipes/bulk` | user | Sequential swipes (enforces free-tier limits). |
| GET | `/matches` | user | Matches with unread counts and privacy-filtered locations. |
| POST | `/matches/:id/unmatch` | user | End the match. |
| POST | `/matches/conversations/:id/read` | user | Read receipt. |

## Chat

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/chat/conversations` | user | Conversation list. |
| GET | `/chat/conversations/:id/messages` | user | Paginated history. |
| POST | `/chat/messages` | user | Send. `clientId` makes retries idempotent. |
| PATCH | `/chat/messages/:id` | user | Edit text within 15 minutes. |
| DELETE | `/chat/messages/:id?forEveryone=true` | user | Delete. |
| POST | `/chat/messages/:id/reactions` | user | React / remove. |
| POST | `/chat/conversations/:id/read` | user | Read receipt. |
| POST | `/chat/conversations/:id/preferences` | user | Mute / archive / pin. |
| GET | `/chat/conversations/:id/search?q=` | user | Message search. |

### WebSocket (Socket.IO)

Authenticated with `auth: { token: <accessToken> }` during the handshake.

| Event | Direction | Payload |
| --- | --- | --- |
| `conversation:join` | client â†’ server | `{ conversationId }` (authorised) |
| `message:send` | client â†’ server | `{ conversationId, kind, body, clientId, attachmentMediaIds, durationSec }` |
| `message:new` | server â†’ room | serialised message |
| `message:typing` | both | `{ conversationId, userId, isTyping }` |
| `message:read` | both | `{ conversationId, userId, readAt }` |
| `message:reaction` | server | `{ messageId, reactions }` |
| `presence` | server | `{ userId, online }` |
| `area:activity` | server | `{ area }` - consented area events only |

## Media

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/media/upload-intent` | user | Validate type/size, create `mediaId`, return signed upload URL. |
| POST | `/media/:id/complete` | user | Mark ready with dimensions/duration. |
| GET | `/media/:id/url` | user | Short-lived signed read URL (authorised per media). |
| DELETE | `/media/:id` | user | Soft delete. |

## Notifications, stories, posts, dates

| Method | Path | Purpose |
| --- | --- | --- |
| GET/PATCH | `/notifications`, `/notifications/read`, `/notifications/read-all` | In-app notifications. |
| POST/DELETE | `/notifications/devices` | Register/remove FCM token. |
| GET/POST | `/stories`, `/stories/:id/view` | 24-hour stories. |
| GET/POST | `/posts`, `/posts/:id/like`, `/posts/:id/comments` | Community posts. |
| GET/POST | `/dates`, `PATCH /dates/:id/respond`, `POST /dates/:id/check-in` | Date planning. |
| GET/POST | `/dates/safety-contacts` | Trusted contact (opt-in, reminder based). |

## Subscriptions

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/subscriptions/me` | Tier, entitlements, payments, active boost. |
| POST | `/subscriptions/subscribe` | `{ tier, idempotencyKey }`. |
| POST | `/subscriptions/cancel` | Cancel. |
| POST | `/subscriptions/boosts` | `{ minutes, idempotencyKey }`. |
| POST | `/subscriptions/webhook` | Public, HMAC-signed gateway callback. |

## Contact unlock (TZS 1,000 per profile)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/contact/unlock/:userId/quote` | user | Price, `alreadyUnlocked`, `ownerAllowsContact`, `canPurchase`. Never the number. |
| GET | `/contact/unlock/:userId/status` | user | Whether the entitlement is active. |
| POST | `/contact/unlock/:userId` | user | `{ idempotencyKey }`. Creates a PENDING payment. `ALREADY_UNLOCKED` when bought before. |
| GET | `/contact/card/:userId` | user | Phone/WhatsApp **only** when entitled AND consented. Writes an access log. |
| POST | `/contact/sharing` | user | Owner: `{ allowContactSharing, allowWhatsAppSharing }`. |
| POST | `/contact/sharing/whatsapp` | user | Owner: WhatsApp consent. |

## Premium videos (TZS 1,000 each)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/videos/categories` | user | Categories. |
| GET | `/videos` | user | Catalog with `owned` and `thumbnailUrl` (signed). |
| GET | `/videos/:id/play` | user | Short-lived signed stream URL, or `VIDEO_NOT_OWNED`. |
| POST | `/videos/:id/purchase` | user | `{ idempotencyKey }`. `ALREADY_OWNED` when bought before. |
| POST/PATCH/DELETE | `/admin/videos[/:id]` | admin | CRUD, publish/unpublish, ban with a moderation note. |

## Payments and wallet

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/payments/me` | user | My payments, contact unlocks, video purchases. |
| POST | `/payments/webhook` | signature | The only path that can create an entitlement. HMAC verified, idempotent. |

## Calls (WebRTC signalling)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/calls` | user | `{ calleeId, type, sdpOffer? }`. Needs an active match + callee consent + a contact entitlement. |
| GET | `/calls/permissions/:userId` | user | `{ allowed, reason }` so the UI can explain a disabled Call button. |
| GET | `/calls/history` | user | My call log. |
| GET | `/calls/:callId` | user | Call state (participants only). |
| POST | `/calls/:callId/end` | user | Hang up. |
| POST | `/calls/:callId/block` | user | Block mid-call: ends it now, prevents future calls. |

Rejection reasons: `SELF_CALL`, `BLOCKED`, `NO_MATCH`, `CALLEE_DISABLED_CALLS`,
`NO_CONTACT_ENTITLEMENT`.

Socket events: `call:invite`, `call:incoming`, `call:accept`, `call:accepted`,
`call:reject`, `call:hangup`, `call:candidate`, `call:pending-candidates`,
`call:ended`, `call:state`. Ring timeout is 45 seconds.

## Payments: gateway configuration

`GET /payments/provider` returns the live driver, whether its credentials are
configured, and whether it is pointed at production. The webhook
(`POST /payments/webhook`) accepts `x-signature`, `x-timestamp` and `x-event-id`.

Checks performed before anything is granted: signature, timestamp freshness
(300 s window), single-use event id, **amount match**, then `SUCCESS` only.

## Location sharing (temporary, consent driven)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/location-sharing/settings` | user | Am I accepting requests, and for how long at most? |
| GET | `/location-sharing/requests` | user | Incoming requests awaiting my decision. |
| GET | `/location-sharing/active` | user | Who can see my location right now. |
| POST | `/location-sharing/request/:ownerId` | user | `{ minutes, note }`. Grants nothing on its own. |
| POST | `/location-sharing/requests/:shareId/respond` | user | `{ accept, minutes }`. Duration is clamped to my maximum. |
| POST | `/location-sharing/stop/:recipientId` | user | Owner: stop immediately. |
| GET | `/location-sharing/with/:ownerId` | user | Shared area + minutes remaining. 403 unless a live grant exists. |

Allowed durations: `15`, `30`, `60`, `120`, `1440` minutes.

## Privacy and discovery preferences

| Method | Path | Purpose |
| --- | --- | --- |
| GET/PATCH | `/privacy/me` | Every consent switch: `showMyProfile`, `allowContactSharing`, `allowWhatsAppSharing`, `allowCalls`, `allowMessages`, `allowLocationRequests`, `maxShareMinutes`, `showOnlineStatus`, `showLastSeen`, `showProfileVideo`, plus the location flags. |
| POST | `/privacy/me/whatsapp` | Store the owner's WhatsApp number (encrypted). |
| GET/PATCH | `/privacy/discovery-preference` | `preferredGender`, age range, distance, relationship goal, `onlyVerified`, `showOnlineFirst`. |

## Admin (role-gated)

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| GET | `/admin/dashboard` | any admin | Counts, aggregate area distribution. |
| GET/PATCH | `/admin/regions`, `/admin/regions/:id/boundary` | admin | Enable regions, set GeoJSON boundary. |
| GET/POST/PATCH/DELETE | `/admin/locations[/:id]` | admin | Areas, wards, villages, streets. |
| GET/POST/PATCH | `/admin/places[/:id]` | admin | Venues; creating one also creates its geofence. |
| POST | `/admin/places/:id/photos` | admin | Attach a photo. |
| GET | `/admin/reports` | any admin | Open reports. |
| POST | `/admin/reports/:id/resolve` | admin/moderator | Resolve or dismiss. |
| POST | `/admin/users/:id/suspend` | super/admin | Suspend an account. |
| GET | `/admin/logs` | any admin | Audit trail. |

### Monetisation and sensitive access

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| POST | `/admin/auth/login` | public + HMAC-style credentials | Admin sign-in (separate from user login). |
| GET | `/admin/monetisation/revenue` | super/admin | Revenue by product, plus today's figure. |
| POST | `/admin/monetisation/users/:userId/contact-read` | super/admin | Decrypts a phone number. Requires a reason of 8+ characters and writes `sensitive_access_logs`. Moderators/support are refused. |
| GET | `/admin/monetisation/sensitive-access` | super/admin/moderator | Audit trail. |
| POST | `/admin/monetisation/entitlements` | super/admin | Manual feature-flag grant, always audited. |

## System

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness + database/cache status. |
| GET | `/system/stats` | Aggregate counters. |
| POST | `/system/maintenance` | Run the cleanup jobs on demand. |