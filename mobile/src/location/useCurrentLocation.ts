import { useCallback, useState } from 'react';
import Geolocation from '@react-native-community/geolocation';
import { locationApi } from '../api/endpoints';
import { useAreaStore } from '../store/settings.store';
import type { DetectLocationResult } from '../types/api';

Geolocation.setRNConfiguration({
  skipPermissionRequests: false,
  authorizationLevel: 'whenInUse',
  locationProvider: 'auto',
});

export type LocationPermissionState = 'unknown' | 'granted' | 'denied' | 'blocked' | 'unavailable';

interface UseCurrentLocation {
  permission: LocationPermissionState;
  detecting: boolean;
  detection: DetectLocationResult | null;
  error: string | null;
  /** Ask for permission and report the position. Safe to call repeatedly. */
  locate: () => Promise<DetectLocationResult | null>;
}

/**
 * Device location.
 *
 * Design decisions:
 *  - Permission is requested once, at onboarding. Denial never blocks account
 *    creation; the user can pick an area manually instead.
 *  - We do NOT stream coordinates. One fix is taken, sent to the server, and
 *    the server decides everything else (area, geofences, alerts).
 *  - The raw coordinates are never stored in app state beyond this call.
 */
export function useCurrentLocation(): UseCurrentLocation {
  const [permission, setPermission] = useState<LocationPermissionState>('unknown');
  const [detecting, setDetecting] = useState(false);
  const [detection, setDetection] = useState<DetectLocationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setArea = useAreaStore((s) => s.setArea);

  const locate = useCallback(async (): Promise<DetectLocationResult | null> => {
    setDetecting(true);
    setError(null);

    const granted = await new Promise<boolean>((resolve) => {
      Geolocation.getCurrentPosition(
        () => resolve(true),
        () => resolve(false),
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 120_000 },
      );
    });

    if (!granted) {
      setPermission('denied');
      setDetecting(false);
      return null;
    }

    return new Promise<DetectLocationResult | null>((resolve) => {
      Geolocation.getCurrentPosition(
        async (position) => {
          try {
            const { latitude, longitude, accuracy } = position.coords;
            const result = await locationApi.detect({
              latitude,
              longitude,
              accuracyM: accuracy ?? undefined,
            });

            setPermission('granted');
            setDetection(result);
            setArea({
              areaName: result.area?.name ?? null,
              areaKind: result.area?.kind ?? null,
              inSupportedRegion: result.inSupportedRegion,
              scopeNotice: result.reason,
            });

            // Persist server side so discovery distance works immediately.
            if (result.inSupportedRegion) {
              await locationApi.report({
                latitude,
                longitude,
                accuracyM: accuracy ?? undefined,
              });
            }

            resolve(result);
          } catch (e) {
            setError((e as Error).message);
            resolve(null);
          } finally {
            setDetecting(false);
          }
        },
        () => {
          setPermission('unavailable');
          setDetecting(false);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 120_000 },
      );
    });
  }, [setArea]);

  return { permission, detecting, detection, error, locate };
}

/** Report a new position later in the session (app foreground). */
export async function reportPosition(): Promise<void> {
  await new Promise<void>((resolve) => {
    Geolocation.getCurrentPosition(
      async (position) => {
        try {
          await locationApi.report({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyM: position.coords.accuracy ?? undefined,
          });
        } finally {
          resolve();
        }
      },
      () => resolve(),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    );
  });
}
