import React, { useEffect } from 'react';
import { StatusBar, StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RootNavigator } from './src/navigation/RootNavigator';
import { ApiError } from './src/api/client';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Never retry auth/permission errors; do retry transient network ones.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App(): React.JSX.Element {
  const scheme = useColorScheme();

  useEffect(() => {
    // Firebase must be initialised before any messaging API is used. Push is
    // optional: registerForPushNotifications swallows a missing Firebase setup,
    // and this guard also covers the module failing to load at all.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const { registerForPushNotifications } = require('./src/notifications/push') as
        typeof import('./src/notifications/push');
      void registerForPushNotifications();
    } catch {
      // Push unavailable - the app runs on in-app notifications.
    }
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
          <RootNavigator />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});