import type { NavigatorScreenParams } from '@react-navigation/native';

export type AuthStackParamList = {
  AgeGate: undefined;
  Login: undefined;
  Register: undefined;
  Otp: { phone: string; mode: 'verify' | 'reset'; devCode?: string };
  LocationSetup: undefined;
  ProfileSetup: undefined;
};

export type MainTabParamList = {
  Discover: undefined;
  Likes: undefined;
  Map: undefined;
  Messages: { conversationId?: string } | undefined;
  Profile: undefined;
};

export type MainStackParamList = {
  Tabs: NavigatorScreenParams<MainTabParamList>;
  UserProfile: { userId: string; displayName?: string };
  PlaceDetails: { placeId: string };
  Chat: { conversationId: string; title?: string };
  ContactUnlock: { userId: string; displayName?: string };
  Videos: undefined;
  Payments: undefined;
  Safety: undefined;
  Calls: undefined;
  IncomingCall: { callId: string; fromUserId: string; type: 'VOICE' | 'VIDEO' };
  OutgoingCall: { callId: string; calleeName: string; type: 'VOICE' | 'VIDEO' };
  Filters: undefined;
  Notifications: undefined;
  Privacy: undefined;
  Premium: undefined;
  DatePlanner: { conversationId: string };
  MatchCelebration: { matchId: string; name: string; score: number | null };
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends MainStackParamList {}
  }
}
