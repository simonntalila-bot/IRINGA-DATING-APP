import { create } from 'zustand';
import { authApi } from '../api/endpoints';
import { secureStore, setUnauthorizedHandler } from '../api/client';
import type { TokenPair } from '../types/api';

interface AuthState {
  accessToken: string | null;
  status: 'unknown' | 'authenticated' | 'anonymous';
  profileCompletePct: number;

  bootstrap: () => Promise<void>;
  setTokens: (tokens: TokenPair) => Promise<void>;
  refreshSession: () => Promise<string | null>;
  signOut: (allDevices?: boolean) => Promise<void>;
  setProfileComplete: (pct: number) => void;
}

let storedRefreshToken: string | null = null;

/**
 * Auth state.
 *
 * The 401 handler installed here performs the rotating refresh and persists the
 * new pair, so an expired access token is invisible to the rest of the app.
 */
export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  status: 'unknown',
  profileCompletePct: 0,

  bootstrap: async () => {
    const accessToken = await secureStore.accessToken();
    storedRefreshToken = await secureStore.refreshToken();

    setUnauthorizedHandler(async () => {
      const refreshed = await get().refreshSession();
      return refreshed ? secureStore.accessToken() : null;
    });

    if (!accessToken) {
      set({ status: 'anonymous' });
      return;
    }

    set({ accessToken });
    try {
      await authApi.me();
      set({ status: 'authenticated' });
    } catch {
      // Expired and unrefreshable: start clean.
      await secureStore.clear();
      set({ accessToken: null, status: 'anonymous' });
    }
  },

  setTokens: async (tokens: TokenPair) => {
    storedRefreshToken = tokens.refreshToken;
    await secureStore.save(tokens);
    set({ accessToken: tokens.accessToken, status: 'authenticated' });
  },

  refreshSession: async () => {
    const refreshToken = storedRefreshToken ?? (await secureStore.refreshToken());
    if (!refreshToken) return null;

    try {
      const tokens = await authApi.refresh(refreshToken);
      await get().setTokens(tokens);
      return tokens.accessToken;
    } catch {
      // Refresh token reuse or expiry means the session is gone for good.
      await secureStore.clear();
      set({ accessToken: null, status: 'anonymous' });
      return null;
    }
  },

  signOut: async (allDevices = false) => {
    try {
      await authApi.logout(storedRefreshToken ?? undefined, allDevices);
    } catch {
      // A failed logout must never trap the user in the app.
    }
    storedRefreshToken = null;
    await secureStore.clear();
    set({ accessToken: null, status: 'anonymous', profileCompletePct: 0 });
  },

  setProfileComplete: (profileCompletePct: number) => set({ profileCompletePct }),
}));
