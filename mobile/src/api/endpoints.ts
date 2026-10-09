import { api, uploadToSignedUrl } from './client';
import type {
  AreaNode,
  AreaNodeTree,
  ConversationListItem,
  DetectLocationResult,
  DiscoveryResponse,
  DiscoveryCandidate,
  LocationReportResult,
  MatchListItem,
  Message,
  NotificationItem,
  Place,
  PrivacySettings,
  TokenPair,
  UploadIntent,
} from '../types/api';

/** Every backend endpoint the app uses, in one place. */
export const authApi = {
  register: (body: {
    phone: string;
    password: string;
    displayName: string;
    dateOfBirth: string;
    gender: string;
    relationshipGoal: string;
    confirm18Plus: true;
  }) => api.post<{ userId: string; otp: { expiresInSeconds: number; devCode: string | null } }>('/auth/register', body),

  login: (body: { phone: string; password: string }) => api.post<TokenPair>('/auth/login', body),

  requestOtp: (body: { target: string; purpose: 'PHONE_VERIFICATION' | 'PASSWORD_RESET' }) =>
    api.post<{ expiresInSeconds: number; devCode: string | null }>('/auth/request-otp', body),

  verifyOtp: (body: { target: string; code: string; purpose: 'PHONE_VERIFICATION' }) =>
    api.post<TokenPair>('/auth/verify-otp', body),

  resetPassword: (body: { phone: string; code: string; newPassword: string }) =>
    api.post<{ ok: boolean }>('/auth/reset-password', body),

  refresh: (refreshToken: string) => api.post<TokenPair>('/auth/refresh', { refreshToken }),

  logout: (refreshToken?: string, allDevices = false) =>
    api.post<{ ok: boolean }>('/auth/logout', { refreshToken, allDevices }),

  me: () => api.get<{ id: string; phone: string; email: string | null; status: string }>('/auth/me'),
};

export const profileApi = {
  me: () => api.get<Record<string, unknown>>('/profiles/me'),
  update: (body: Record<string, unknown>) => api.patch<{ profileCompletePct: number }>('/profiles/me', body),
  interests: () =>
    api.get<Array<{ slug: string; labelEn: string; labelSw: string; emoji: string | null; category: string }>>(
      '/profiles/interests',
    ),
  setInterests: (slugs: string[]) => api.put<{ ok: boolean }>('/profiles/me/interests', { slugs }),
  addPhoto: (mediaId: string) => api.post<{ id: string }>('/profiles/me/photos', { mediaId }),
  removePhoto: (photoId: string) => api.delete<{ ok: boolean }>(`/profiles/me/photos/${photoId}`),
  view: (userId: string) => api.get<Record<string, unknown>>(`/profiles/${userId}`),
};

export const locationApi = {
  /** Public: works before an account exists (onboarding). */
  detect: (body: { latitude: number; longitude: number; accuracyM?: number }) =>
    api.post<DetectLocationResult>('/locations/detect', body),

  report: (body: { latitude: number; longitude: number; accuracyM?: number; source?: 'gps' | 'manual' }) =>
    api.post<LocationReportResult>('/locations/report', body),

  manualArea: (nodeId: string) => api.post<LocationReportResult>('/locations/manual-area', { nodeId }),

  areas: (params?: { kind?: string; search?: string }) => api.get<AreaNode[]>('/locations/areas', params),
  areaTree: (region?: string) => api.get<AreaNodeTree[]>('/locations/areas/tree', { region }),
  myLocation: () =>
    api.get<{
      inSupportedRegion: boolean;
      area: { name: string; kind: string } | null;
      reason: string | null;
      mine: { latitude: number; longitude: number; recordedAt: string } | null;
      privacy: PrivacySettings;
    }>('/geofencing/my-location'),
};

export const discoveryApi = {
  discover: (params: {
    mode?: 'nearby' | 'recommended' | 'new' | 'active';
    minAge?: number;
    maxAge?: number;
    maxDistanceKm?: number;
    relationshipGoal?: string;
    interests?: string[];
    verifiedOnly?: boolean;
    onlineOnly?: boolean;
    limit?: number;
    cursor?: string;
  }) => api.get<DiscoveryResponse>('/discovery', params as Record<string, unknown>),

  likesReceived: () => api.get<Array<Record<string, unknown>>>('/discovery/likes-received'),
  undo: () => api.post<{ removed: string | null }>('/discovery/undo'),
  swipe: (targetId: string, type: 'PASS' | 'LIKE' | 'SUPER_LIKE') =>
    api.post<{
      swipe: string;
      matched: boolean;
      matchId: string | null;
      compatibilityScore: number | null;
      remainingLikes: number | null;
    }>('/swipes', { targetId, type }),
};

export const matchApi = {
  list: () => api.get<MatchListItem[]>('/matches'),
  unmatch: (matchId: string) => api.post<{ ok: boolean }>(`/matches/${matchId}/unmatch`),
};

export const chatApi = {
  conversations: () => api.get<ConversationListItem[]>('/chat/conversations'),
  messages: (conversationId: string, before?: string) =>
    api.get<Message[]>(`/chat/conversations/${conversationId}/messages`, { limit: 50, before }),
  send: (body: {
    conversationId: string;
    kind?: string;
    body?: string;
    clientId?: string;
    replyToId?: string;
    attachmentMediaIds?: string[];
    durationSec?: number;
  }) => api.post<Message>('/chat/messages', body),
  markRead: (conversationId: string) => api.post<{ ok: boolean }>(`/chat/conversations/${conversationId}/read`),
  search: (conversationId: string, q: string) =>
    api.get<Message[]>(`/chat/conversations/${conversationId}/search`, { q }),
};

export const placeApi = {
  categories: () =>
    api.get<Array<{ id: string; slug: string; labelEn: string; labelSw: string; emoji: string | null }>>(
      '/locations/place-categories',
    ),
  list: (params?: {
    category?: string;
    nodeId?: string;
    latitude?: number;
    longitude?: number;
    radiusKm?: number;
    datingFriendly?: string;
    search?: string;
  }) => api.get<Place[]>('/locations/places', params as Record<string, unknown>),
  detail: (idOrSlug: string) => api.get<Place>(`/locations/places/${idOrSlug}`),
};

export const notificationApi = {
  list: () => api.get<NotificationItem[]>('/notifications'),
  unreadCount: () => api.get<{ count: number }>('/notifications/unread-count'),
  markAllRead: () => api.patch<{ ok: boolean }>('/notifications/read-all'),
  registerDevice: (token: string, platform: 'android' | 'ios') =>
    api.post<{ ok: boolean }>('/notifications/devices', { token, platform }),
};

export const userApi = {
  privacy: () => api.get<PrivacySettings>('/users/me/privacy'),
  updatePrivacy: (body: Partial<PrivacySettings>) => api.patch<PrivacySettings>('/users/me/privacy', body),
  block: (targetId: string, reason?: string) => api.post<{ ok: boolean }>(`/users/me/blocks/${targetId}`, { reason }),
  unblock: (targetId: string) => api.delete<{ ok: boolean }>(`/users/me/blocks/${targetId}`),
  blocked: () => api.get<Array<{ id: string; user: { userId: string; displayName: string } }>>('/users/me/blocks'),
};

export const subscriptionApi = {
  status: () => api.get<Record<string, unknown>>('/subscriptions/me'),
  subscribe: (tier: 'PREMIUM' | 'VIP', idempotencyKey: string) =>
    api.post<{ paymentId: string; status: string }>('/subscriptions/subscribe', { tier, idempotencyKey }),
  cancel: () => api.post<{ ok: boolean }>('/subscriptions/cancel'),
  boost: (minutes: 30 | 60 | 180, idempotencyKey: string) =>
    api.post<{ paymentId: string; status: string }>('/subscriptions/boosts', { minutes, idempotencyKey }),
};

export const dateApi = {
  list: () => api.get<Array<Record<string, unknown>>>('/dates'),
  propose: (body: {
    conversationId: string;
    placeId?: string;
    placeName?: string;
    scheduledFor: string;
    note?: string;
  }) => api.post<{ id: string; placeName: string; scheduledFor: string; status: string }>('/dates', body),
  respond: (planId: string, accept: boolean) => api.patch<{ ok: boolean }>(`/dates/${planId}/respond`, { accept }),
  checkIn: (planId: string, type: 'CHECK_IN' | 'CHECK_OUT') =>
    api.post<{ ok: boolean }>(`/dates/${planId}/check-in`, { type }),
  safetyContacts: () => api.get<Array<{ id: string; name: string; phone: string }>>('/dates/safety-contacts'),
  addSafetyContact: (body: { name: string; phone: string }) => api.post<{ id: string }>('/dates/safety-contacts', body),
};

export const storyApi = {
  feed: () => api.get<Array<Record<string, unknown>>>('/stories'),
  create: (body: { mediaId?: string; textBody?: string; privacy?: string }) =>
    api.post<{ id: string }>('/stories', body),
  view: (storyId: string) => api.post<{ ok: boolean }>(`/stories/${storyId}/view`),
};

export const mediaApi = {
  createIntent: (body: {
    type: 'IMAGE' | 'VIDEO' | 'AUDIO';
    mimeType: string;
    sizeBytes: number;
    durationSec?: number;
  }) => api.post<UploadIntent>('/media/upload-intent', body),

  complete: (mediaId: string, meta: { width?: number; height?: number; durationSec?: number }) =>
    api.post<{ mediaId: string; ready: true }>(`/media/${mediaId}/complete`, meta),

  /** Signed, short-lived URL. Authorisation happens server side. */
  url: (mediaId: string) => api.get<{ url: string; expiresInSeconds: number }>(`/media/${mediaId}/url`),

  upload: async (file: { uri: string; name: string; type: string; size: number }, durationSec?: number) => {
    const type = file.type.startsWith('video') ? 'VIDEO' : file.type.startsWith('audio') ? 'AUDIO' : 'IMAGE';

    const intent = await mediaApi.createIntent({
      type,
      mimeType: file.type,
      sizeBytes: file.size,
      durationSec,
    });

    await uploadToSignedUrl(intent.uploadUrl, intent.headers, file);

    return mediaApi.complete(intent.mediaId, { durationSec });
  },
};

export type { DiscoveryCandidate };

// ---------------------------------------------------------------------------
// Monetisation: contact unlock + premium media
// ---------------------------------------------------------------------------

export interface ContactQuote {
  priceMinor: number;
  currency: string;
  alreadyUnlocked: boolean;
  ownerAllowsContact: boolean;
  ownerDisplayName: string;
  canPurchase: boolean;
  blockedReason: string | null;
}

export interface ContactCard {
  phone: string | null;
  phoneMasked: string | null;
  whatsapp: string | null;
  whatsappUrl: string | null;
  canCall: boolean;
  canRequestLocation: boolean;
  entitlementActive: boolean;
  reason: string | null;
}

/**
 * Contact unlock costs TZS 1,000 per target profile. The app never decides
 * whether access is granted - it asks the server for a quote and a card, and the
 * server decides. `ALREADY_UNLOCKED` means the buyer already paid.
 */
export const contactApi = {
  quote: (userId: string) => api.get<ContactQuote>(`/contact/unlock/${userId}/quote`),
  status: (userId: string) =>
    api.get<{ unlocked: boolean; unlockedAt: string | null }>(`/contact/unlock/${userId}/status`),
  purchase: (userId: string, idempotencyKey: string) =>
    api.post<{ paymentId: string; status: string; reused: boolean }>(`/contact/unlock/${userId}`, { idempotencyKey }),
  card: (userId: string) => api.get<ContactCard>(`/contact/card/${userId}`),
  setSharing: (allowContactSharing: boolean, allowWhatsAppSharing?: boolean) =>
    api.post<{ ok: boolean }>('/contact/sharing', { allowContactSharing, allowWhatsAppSharing }),
  setWhatsappSharing: (allowWhatsAppSharing: boolean) =>
    api.post<{ ok: boolean }>('/contact/sharing/whatsapp', { allowWhatsAppSharing }),
  saveWhatsappNumber: (whatsapp: string) =>
    api.post<{ stored: boolean; masked: string }>('/privacy/me/whatsapp', { whatsapp }),
};

export interface VideoCatalogItem {
  id: string;
  title: string;
  description: string | null;
  category: { slug: string; labelEn: string; labelSw: string; emoji: string | null };
  durationSec: number | null;
  isPremium: boolean;
  priceMinor: number;
  currency: string;
  owned: boolean;
  thumbnailUrl: string | null;
}

export const videoApi = {
  categories: () =>
    api.get<Array<{ id: string; slug: string; labelEn: string; labelSw: string; emoji: string | null }>>(
      '/videos/categories',
    ),
  catalog: (params?: { category?: string; search?: string; limit?: number }) =>
    api.get<VideoCatalogItem[]>('/videos', params as Record<string, unknown>),
  /** Returns a short-lived signed URL, or 402/403 VIDEO_NOT_OWNED. */
  play: (videoId: string) => api.get<{ url: string; expiresInSeconds: number }>(`/videos/${videoId}/play`),
  purchase: (videoId: string, idempotencyKey: string) =>
    api.post<{ paymentId: string; status: string }>(`/videos/${videoId}/purchase`, { idempotencyKey }),
};

export const paymentApi = {
  wallet: () =>
    api.get<{
      payments: Array<{
        id: string;
        type: string;
        status: string;
        amountMinor: number;
        currency: string;
        createdAt: string;
        paidAt: string | null;
        items: Array<{ productType: string; status: string; label: string }>;
      }>;
      contactUnlocks: Array<{
        id: string;
        profileName: string;
        status: string;
        amountMinor: number;
        createdAt: string;
      }>;
      videoPurchases: Array<{ id: string; title: string; status: string; amountMinor: number; createdAt: string }>;
    }>('/payments/me'),
};

/**
 * Temporary live location. This is consent driven: a request does nothing on
 * its own, the owner has to accept, and the grant expires.
 */
export const locationSharingApi = {
  settings: () => api.get<{ allowLocationRequests: boolean; maxShareMinutes: number }>('/location-sharing/settings'),
  active: () =>
    api.get<Array<{ permissionId: string; recipientName: string; expiresAt: string; minutesRemaining: number }>>(
      '/location-sharing/active',
    ),
  requests: () =>
    api.get<Array<{ id: string; requestedMinutes: number; note: string | null; createdAt: string }>>(
      '/location-sharing/requests',
    ),
  request: (ownerId: string, minutes: number, note?: string) =>
    api.post<{ shareId: string; status: string; alreadyActive: boolean }>(`/location-sharing/request/${ownerId}`, {
      minutes,
      note,
    }),
  respond: (shareId: string, accept: boolean, minutes?: number) =>
    api.post<{ status: string; minutes?: number; expiresAt?: string }>(
      `/location-sharing/requests/${shareId}/respond`,
      {
        accept,
        minutes,
      },
    ),
  stop: (recipientId: string) => api.post<{ stopped: boolean }>(`/location-sharing/stop/${recipientId}`),
  liveWith: (ownerId: string) =>
    api.get<{ areaName: string; accuracyM: number | null; sharedUntil: string; minutesRemaining: number }>(
      `/location-sharing/with/${ownerId}`,
    ),
};

export const privacyApi = {
  settings: () => api.get<Record<string, boolean | number | string>>('/privacy/me'),
  update: (body: Record<string, boolean | number | string>) =>
    api.patch<Record<string, boolean | number | string>>('/privacy/me', body),
  discoveryPreference: () => api.get<Record<string, unknown>>('/privacy/discovery-preference'),
  updateDiscoveryPreference: (body: Record<string, unknown>) =>
    api.patch<Record<string, unknown>>('/privacy/discovery-preference', body),
};

/** Safety reporting with the adult-dating reasons from the spec. */
export const reportApi = {
  reasons: [
    'FAKE_PROFILE',
    'SCAM',
    'HARASSMENT',
    'SPAM',
    'THREAT',
    'UNDERAGE',
    'NON_CONSENSUAL_CONTENT',
    'BLACKMAIL_EXTORTION',
    'PROHIBITED_SEXUAL_SERVICES',
    'TRAFFICKING_OR_COERCION',
    'OTHER',
  ] as const,
  reportUser: (userId: string, reason: string, details?: string) =>
    api.post<{ reportId: string; duplicate: boolean }>(`/reports/users/${userId}`, { reason, details }),
  mine: () => api.get<Array<{ id: string; reason: string; status: string; createdAt: string }>>('/reports/mine'),
};

/**
 * Voice / video calls.
 *
 * Authorisation lives on the server: an active match, the callee's `allowCalls`
 * consent, and a valid contact entitlement are all required. `permissions()`
 * lets the UI grey out the Call button with the exact reason.
 */
export const callApi = {
  permissions: (userId: string) => api.get<{ allowed: boolean; reason: string | null }>(`/calls/permissions/${userId}`),
  initiate: (body: { calleeId: string; type: 'VOICE' | 'VIDEO'; sdpOffer?: string; conversationId?: string }) =>
    api.post<{ callId: string; status: string; ringTimeoutAt: string }>('/calls', body),
  history: () =>
    api.get<
      Array<{
        callId: string;
        direction: 'INCOMING' | 'OUTGOING';
        otherUserId: string;
        otherName: string;
        type: 'VOICE' | 'VIDEO';
        status: string;
        startedAt: string;
      }>
    >('/calls/history'),
  end: (callId: string, reason?: string) =>
    api.post<{ callId: string; status: string }>(`/calls/${callId}/end`, { reason }),
  blockDuringCall: (callId: string) =>
    api.post<{ callId: string; otherUserId: string; ok: boolean }>(`/calls/${callId}/block`),
};

export const accountApi = {
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ ok: boolean; sessionsRevoked: boolean }>('/auth/change-password', { currentPassword, newPassword }),
  sessions: () => api.get<Array<{ id: string; deviceName: string | null; lastSeenAt: string }>>('/auth/sessions'),
  revokeSession: (id: string) => api.delete<{ ok: boolean }>(`/auth/sessions/${id}`),
  exportData: () => api.get<Record<string, unknown>>('/auth/me/export'),
  deleteAccount: () => api.delete<{ ok: boolean }>('/auth/me'),
};
