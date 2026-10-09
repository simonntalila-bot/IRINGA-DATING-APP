import { create } from 'zustand';

export interface AppSettings {
  /** null = follow the system theme */
  themeMode: 'light' | 'dark' | null;
  /** Master switch for every location-related feature. */
  locationEnabled: boolean;
  notificationsEnabled: boolean;
  discoveryRadiusKm: number;
}

interface SettingsState extends AppSettings {
  set: (patch: Partial<AppSettings>) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  themeMode: null,
  locationEnabled: true,
  notificationsEnabled: true,
  discoveryRadiusKm: 50,
  set: (patch) => set(patch),
}));

interface AreaState {
  areaName: string | null;
  areaKind: string | null;
  inSupportedRegion: boolean;
  /** Reason shown when discovery is unavailable (outside Iringa). */
  scopeNotice: string | null;
  setArea: (payload: {
    areaName: string | null;
    areaKind: string | null;
    inSupportedRegion: boolean;
    scopeNotice?: string | null;
  }) => void;
}

export const useAreaStore = create<AreaState>((set) => ({
  areaName: null,
  areaKind: null,
  inSupportedRegion: true,
  scopeNotice: null,
  setArea: ({ areaName, areaKind, inSupportedRegion, scopeNotice }) =>
    set({ areaName, areaKind, inSupportedRegion, scopeNotice: scopeNotice ?? null }),
}));
