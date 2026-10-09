/** Shared API types. Mirrors the backend DTOs and response shapes. */

export type Gender = 'FEMALE' | 'MALE' | 'OTHER' | 'UNDISCLOSED';

export type RelationshipGoal = 'MARRIAGE' | 'LONG_TERM' | 'SERIOUS_DATING' | 'SHORT_TERM' | 'FRIENDSHIP';

export type LocationVisibility = 'HIDDEN' | 'APPROXIMATE_AREA' | 'MATCHES_GENERAL_AREA';

export type MessageKind = 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' | 'SYSTEM';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  refreshExpiresAt: string;
}

export interface ApproximateLocationView {
  areaName: string | null;
  areaKind: string | null;
  distanceKm: number | null;
  distanceLabel: 'NEARBY' | 'CLOSE' | 'IN_AREA' | 'AWAY' | 'UNKNOWN';
  distanceText: string;
  exactLocationShared: false;
}

export interface DiscoveryCandidate {
  userId: string;
  displayName: string;
  age: number;
  gender: Gender;
  relationshipGoal: string;
  bio: string | null;
  photoMediaId: string | null;
  interests: string[];
  areaName: string | null;
  distanceText: string;
  distanceLabel: string;
  compatibilityScore: number;
  commonInterests: string[];
  verifiedPhone: boolean;
  selfieVerified: boolean;
  isOnline: boolean;
  lastActive: string | null;
  boosted: boolean;
}

export interface DiscoveryResponse {
  items: DiscoveryCandidate[];
  nextCursor: string | null;
}

export interface MatchListItem {
  matchId: string;
  conversationId: string | null;
  compatibilityScore: number;
  matchedAt: string;
  lastMessageAt: string | null;
  unreadMessages: number;
  isOnline: boolean;
  user: {
    userId: string;
    displayName: string;
    age: number | null;
    photoMediaId: string | null;
    lastActiveAt: string | null;
    location: ApproximateLocationView;
  };
}

export interface Message {
  id: string;
  conversationId: string;
  clientId: string | null;
  kind: MessageKind;
  body: string | null;
  durationSec: number | null;
  isMine: boolean;
  sender: { id: string; displayName: string };
  attachments: Array<{ mediaId: string; position: number }>;
  reactions: Array<{ emoji: string; userId: string }>;
  replyTo: { id: string; body: string | null; kind: MessageKind; senderName: string } | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface ConversationListItem {
  conversationId: string;
  isMuted: boolean;
  isArchived: boolean;
  isPinned: boolean;
  compatibilityScore: number;
  lastMessageAt: string;
  unreadMessages: number;
  isOnline: boolean;
  lastSeenAt: string | null;
  other: { userId: string; displayName: string; photoMediaId: string | null };
  lastMessage: {
    id: string;
    kind: MessageKind;
    body: string | null;
    mediaIds: string[];
    senderId: string;
    createdAt: string;
  } | null;
}

export interface Place {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  address: string | null;
  latitude: number;
  longitude: number;
  radiusM: number;
  openingHours: Record<string, string> | null;
  phone: string | null;
  website: string | null;
  isDatingFriendly: boolean;
  isVerified: boolean;
  category: { slug: string; labelEn: string; labelSw: string; emoji: string | null };
  area: { id: string; name: string; kind: string } | null;
  distanceKm: number | null;
}

export interface AreaNode {
  id: string;
  name: string;
  slug: string;
  kind: 'DISTRICT' | 'MUNICIPALITY' | 'WARD' | 'AREA' | 'VILLAGE' | 'STREET';
  description: string | null;
}

export interface AreaNodeTree extends AreaNode {
  children: AreaNodeTree[];
}

export interface PrivacySettings {
  locationVisibility: LocationVisibility;
  shareAreaWithMatches: boolean;
  allowAreaActivityAlerts: boolean;
  allowPlaceAlerts: boolean;
  discoveryRadiusKm: number;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
}

export interface UploadIntent {
  mediaId: string;
  storageKey: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresInSeconds: number;
  maxBytes: number;
  driver: 'r2' | 'local';
}

export interface DetectLocationResult {
  inSupportedRegion: boolean;
  region: { slug: string; name: string } | null;
  area: { nodeId: string; name: string; kind: string; slug: string; matchedBy: string } | null;
  distanceToCentreKm: number;
  reason: string | null;
}

export interface LocationReportResult {
  accepted: boolean;
  throttled: boolean;
  inSupportedRegion: boolean;
  area: { nodeId: string; name: string; kind: string } | null;
  reason: string | null;
  distanceText: string;
  alerts: string[];
}
