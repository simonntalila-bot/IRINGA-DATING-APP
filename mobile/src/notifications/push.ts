import messaging from '@react-native-firebase/messaging';
import { notificationApi } from '../api/endpoints';
import { useAuthStore } from '../store/auth.store';
import { getSocket, onSocket } from '../services/socket';

/**
 * Push notifications (Firebase Cloud Messaging).
 *
 * The FCM API key is a public client identifier and lives in google-services.json
 * (generated from the Firebase console, never committed with secrets). All
 * authorisation still happens on the backend.
 */
export async function registerForPushNotifications(): Promise<void> {
  // Without google-services.json the native Firebase app is not initialised and
  // every messaging() call throws. Push is an enhancement: the backend still
  // persists notifications and the in-app list stays complete, so failing here
  // must never take the app down with it.
  try {
    await registerIfAvailable();
  } catch {
    // Firebase unavailable - in-app notifications only.
  }
}

async function registerIfAvailable(): Promise<void> {
  const status = await messaging().requestPermission();
  const granted =
    status === messaging.AuthorizationStatus.AUTHORIZED || status === messaging.AuthorizationStatus.PROVISIONAL;

  if (!granted) {
    // Denial is fine. In-app notifications keep working.
    return;
  }

  const token = await messaging().getToken();
  const accessToken = useAuthStore.getState().accessToken;
  if (!token || !accessToken) return;

  try {
    await notificationApi.registerDevice(token, 'android');
  } catch {
    // Retry happens on the next app start.
  }

  messaging().onTokenRefresh((refreshed) => {
    void notificationApi.registerDevice(refreshed, 'android').catch(() => undefined);
  });

  // Foreground messages: still record them so the in-app list stays complete.
  messaging().onMessage(async () => undefined);

  getSocket(accessToken);
  onSocket('area:activity', () => undefined);
}
