import React, { useEffect } from 'react';
import { NavigationContainer, type LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth.store';
import { reportPosition } from '../location/useCurrentLocation';
import { getSocket } from '../services/socket';
import { Loader } from '../components/Feedback';
import { AgeGateScreen, LoginScreen, RegisterScreen } from '../screens/auth/AuthScreens';
import { LocationSetupScreen, OtpScreen } from '../screens/auth/OtpAndLocationScreens';
import { ProfileSetupScreen } from '../screens/auth/ProfileSetupScreen';
import { DiscoverScreen } from '../screens/discover/DiscoverScreen';
import { FiltersScreen, LikesScreen } from '../screens/discover/LikesAndFilters';
import { ChatListScreen, ChatScreen } from '../screens/chat/ChatScreens';
import { MapScreen, PlaceDetailsScreen } from '../screens/map/MapScreens';
import { NotificationsScreen, PrivacyScreen, ProfileScreen } from '../screens/profile/ProfileScreens';
import { CallHistoryScreen, IncomingCallScreen, OutgoingCallScreen } from '../components/CallScreens';
import { ContactUnlockScreen } from '../components/ContactUnlockScreen';
import { VideoLibraryScreen } from '../components/VideoLibraryScreen';
import { PaymentsScreen } from '../components/PaymentsScreen';
import { SafetyCenterScreen } from '../components/SafetyCenterScreen';
import { colors } from '../theme';
import type { AuthStackParamList, MainStackParamList, MainTabParamList } from './types';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();
const MainStack = createNativeStackNavigator<MainStackParamList>();

function AuthNavigator(): React.JSX.Element {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="AgeGate" component={AgeGateScreen} />
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
      <AuthStack.Screen name="Otp" component={OtpScreen} />
      <AuthStack.Screen name="LocationSetup" component={LocationSetupScreen} />
      <AuthStack.Screen name="ProfileSetup" component={ProfileSetupScreen} />
    </AuthStack.Navigator>
  );
}

function TabNavigator(): React.JSX.Element {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tabs.Screen name="Discover" component={DiscoverScreen} options={{ title: 'Discover' }} />
      <Tabs.Screen name="Likes" component={LikesScreen} options={{ title: 'Matches' }} />
      <Tabs.Screen name="Map" component={MapScreen} options={{ title: 'Iringa' }} />
      <Tabs.Screen name="Messages" component={ChatListScreen} options={{ title: 'Chats' }} />
      <Tabs.Screen name="Profile" component={ProfileScreen} options={{ title: 'Me' }} />
    </Tabs.Navigator>
  );
}

/** Chat is a full-screen route so the keyboard behaves correctly. */
function ChatRoute({ route }: NativeStackScreenProps<MainStackParamList, 'Chat'>): React.JSX.Element {
  return <ChatScreen route={route} />;
}

function MainNavigator(): React.JSX.Element {
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    getSocket(accessToken);
  }, [accessToken]);

  /**
   * Battery-conscious location policy: one position refresh every 15 minutes
   * while the app is in the foreground. The server throttles anything more
   * aggressive anyway.
   */
  useEffect(() => {
    const interval = setInterval(() => {
      void reportPosition();
      void queryClient.invalidateQueries({ queryKey: ['discovery'] });
    }, 15 * 60_000);

    return () => clearInterval(interval);
  }, [queryClient]);

  return (
    <MainStack.Navigator>
      <MainStack.Screen name="Tabs" component={TabNavigator} options={{ headerShown: false }} />
      <MainStack.Screen name="PlaceDetails" component={PlaceDetailsScreen} />
      <MainStack.Screen name="ContactUnlock" component={ContactUnlockScreen} />
      <MainStack.Screen name="Videos" component={VideoLibraryScreen} />
      <MainStack.Screen name="Payments" component={PaymentsScreen} />
      <MainStack.Screen name="Safety" component={SafetyCenterScreen} />
      <MainStack.Screen name="Calls" component={CallHistoryScreen} />
      <MainStack.Screen
        name="IncomingCall"
        component={IncomingCallScreen}
        options={{ presentation: 'fullScreenModal' }}
      />
      <MainStack.Screen
        name="OutgoingCall"
        component={OutgoingCallScreen}
        options={{ presentation: 'fullScreenModal' }}
      />
      <MainStack.Screen name="Filters" component={FiltersScreen} options={{ presentation: 'modal' }} />
      <MainStack.Screen name="Notifications" component={NotificationsScreen} />
      <MainStack.Screen name="Privacy" component={PrivacyScreen} />
      <MainStack.Screen
        name="Chat"
        component={ChatRoute}
        options={({ route }) => ({ title: route.params.title ?? 'Chat' })}
      />
    </MainStack.Navigator>
  );
}

/**
 * Deep links.
 *
 * Prefixes cover Android App Links and iOS Universal Links (the app must be
 * verified on the domain) plus a custom scheme for local testing. A link that
 * arrives before the user has signed in is handled by React Navigation after
 * the auth stack swaps, which is the deferred deep-link behaviour the spec
 * asks for.
 */
const linking: LinkingOptions<MainStackParamList> = {
  prefixes: ['https://app.iringadating.co', 'iringadating://'],
  config: {
    screens: {
      Tabs: {
        screens: {
          Discover: 'discover',
          Likes: 'matches',
          Map: 'map',
          Messages: 'messages',
          Profile: 'profile',
        },
      },
      PlaceDetails: 'place/:id',
      Filters: 'filters',
      Notifications: 'notifications',
      Privacy: 'privacy',
      Chat: 'chat/:conversationId',
    },
  },
};

export function RootNavigator(): React.JSX.Element {
  const status = useAuthStore((s) => s.status);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (status === 'unknown') return <Loader label="Starting Iringa Dating" />;

  return (
    <NavigationContainer linking={linking}>
      {status === 'authenticated' ? <MainNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}
