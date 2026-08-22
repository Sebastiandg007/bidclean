/**
 * useSettings — Zustand store for user settings (language, theme, notifications).
 *
 * Manages preferences with local persistence (SecureStore) and backend sync.
 * Language changes trigger immediate i18n reload.
 * Theme changes apply immediately via store state.
 */

import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import i18n from 'i18next';
import type { ThemePreference } from './profile.types';

// ─── Constants ───────────────────────────────────────────────────────────────

const SECURE_STORE_SETTINGS_KEY = 'bidclean_user_settings';

const ENDPOINTS = {
  SETTINGS: '/profile/me/settings',
} as const;

const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl'] as const;
const VALID_THEMES: ThemePreference[] = ['dark', 'light', 'system'];

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SettingsData {
  language: string;
  theme: ThemePreference;
  isPushEnabled: boolean;
  isEmailNotificationsEnabled: boolean;
  isSoundsEnabled: boolean;
}

export interface SettingsState {
  settings: SettingsData | null;
  isLoading: boolean;
  error: string | null;
}

export interface SettingsActions {
  loadFromLocal: () => Promise<void>;
  fetchFromBackend: () => Promise<void>;
  updateLanguage: (language: SupportedLanguage) => Promise<void>;
  updateTheme: (theme: ThemePreference) => Promise<void>;
  updateNotification: (field: NotificationField, value: boolean) => Promise<void>;
  reset: () => void;
}

export type NotificationField =
  | 'isPushEnabled'
  | 'isEmailNotificationsEnabled'
  | 'isSoundsEnabled';

export type SettingsStore = SettingsState & SettingsActions;

// ─── Default Settings ────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: SettingsData = {
  language: 'en',
  theme: 'system',
  isPushEnabled: true,
  isEmailNotificationsEnabled: true,
  isSoundsEnabled: true,
};

// ─── Initial State ───────────────────────────────────────────────────────────

const initialState: SettingsState = {
  settings: null,
  isLoading: false,
  error: null,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getApiClient() {
  const { apiClient } = await import('../../services/api.service');
  return apiClient;
}

function extractErrorMessage(err: unknown, fallbackKey: string): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallbackKey;
}

async function persistToLocal(settings: SettingsData): Promise<void> {
  try {
    const serialized = JSON.stringify(settings);
    await SecureStore.setItemAsync(SECURE_STORE_SETTINGS_KEY, serialized);
  } catch (error) {
    console.error('[Settings] Failed to persist locally:', error);
  }
}

async function readFromLocal(): Promise<SettingsData | null> {
  try {
    const raw = await SecureStore.getItemAsync(SECURE_STORE_SETTINGS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SettingsData;
  } catch (error) {
    console.error('[Settings] Failed to read from local:', error);
    return null;
  }
}

async function syncToBackend(partial: Partial<SettingsData>): Promise<SettingsData> {
  const client = await getApiClient();
  const response = await client.patch<SettingsData>(ENDPOINTS.SETTINGS, partial);
  return response.data;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...initialState,

  loadFromLocal: async () => {
    set({ isLoading: true, error: null });

    try {
      const local = await readFromLocal();
      if (local) {
        set({ settings: local, isLoading: false });
        applyLanguage(local.language);
      } else {
        set({ settings: DEFAULT_SETTINGS, isLoading: false });
      }
    } catch {
      set({ settings: DEFAULT_SETTINGS, isLoading: false });
    }
  },

  fetchFromBackend: async () => {
    set({ isLoading: true, error: null });

    try {
      const client = await getApiClient();
      const response = await client.get<SettingsData>(ENDPOINTS.SETTINGS);
      const settings = response.data;

      set({ settings, isLoading: false });
      await persistToLocal(settings);
      applyLanguage(settings.language);
    } catch (err) {
      const message = extractErrorMessage(err, 'profile.settings.error.fetch_failed');
      set({ error: message, isLoading: false });
    }
  },

  updateLanguage: async (language: SupportedLanguage) => {
    const current = get().settings;
    if (!current) return;

    const updated = { ...current, language };
    set({ settings: updated, error: null });
    applyLanguage(language);
    await persistToLocal(updated);

    try {
      await syncToBackend({ language });
    } catch (err) {
      const message = extractErrorMessage(err, 'profile.settings.error.sync_failed');
      set({ error: message });
    }
  },

  updateTheme: async (theme: ThemePreference) => {
    const current = get().settings;
    if (!current) return;

    const updated = { ...current, theme };
    set({ settings: updated, error: null });
    await persistToLocal(updated);

    try {
      await syncToBackend({ theme });
    } catch (err) {
      const message = extractErrorMessage(err, 'profile.settings.error.sync_failed');
      set({ error: message });
    }
  },

  updateNotification: async (field: NotificationField, value: boolean) => {
    const current = get().settings;
    if (!current) return;

    const updated = { ...current, [field]: value };
    set({ settings: updated, error: null });
    await persistToLocal(updated);

    try {
      await syncToBackend({ [field]: value });
    } catch (err) {
      const message = extractErrorMessage(err, 'profile.settings.error.sync_failed');
      set({ error: message });
    }
  },

  reset: () => {
    set(initialState);
  },
}));

// ─── Side Effects ────────────────────────────────────────────────────────────

function applyLanguage(language: string): void {
  if (SUPPORTED_LANGUAGES.includes(language as SupportedLanguage)) {
    i18n.changeLanguage(language);
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Convenience hook returning the full settings store.
 */
export function useSettings(): SettingsStore {
  return useSettingsStore();
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export { SUPPORTED_LANGUAGES, VALID_THEMES, DEFAULT_SETTINGS };

export default useSettings;
