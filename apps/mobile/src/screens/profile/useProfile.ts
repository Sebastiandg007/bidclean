/**
 * useProfile — Zustand store hook + API calls for profile data.
 *
 * Manages full private profile, completeness, and CRUD operations.
 * Fetches profile on demand, caches locally in the store.
 * Uses split endpoints: PATCH /profile/me (common), /profile/me/host, /profile/me/cleaner.
 */

import { create } from 'zustand';
import type {
  FullProfile,
  ProfileCompleteness,
  CommonProfile,
  HostProfile,
  CleanerProfile,
} from './profile.types';
import { PROFILE_PHOTO } from './profile.constants';

// ─── Constants ───────────────────────────────────────────────────────────────

const ENDPOINTS = {
  PROFILE: '/profile/me',
  COMPLETENESS: '/profile/me/completeness',
  HOST: '/profile/me/host',
  CLEANER: '/profile/me/cleaner',
  PHOTO: '/profile/me/photo',
} as const;

/** i18n error keys for profile operations */
const ERROR_KEYS = {
  FETCH_PROFILE: 'profile.error.fetch_failed',
  UPDATE_COMMON: 'profile.error.update_failed',
  UPDATE_HOST: 'profile.error.update_host_failed',
  UPDATE_CLEANER: 'profile.error.update_cleaner_failed',
  UPLOAD_PHOTO: 'profile.error.upload_photo_failed',
  REMOVE_PHOTO: 'profile.error.remove_photo_failed',
} as const;

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

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProfileState {
  profile: FullProfile | null;
  isLoading: boolean;
  error: string | null;
}

export interface ProfileActions {
  fetchProfile: () => Promise<void>;
  fetchCompleteness: () => Promise<void>;
  updateCommon: (data: Partial<Pick<CommonProfile, 'displayName' | 'phoneNumber'>>) => Promise<void>;
  updateHost: (data: Partial<Pick<HostProfile, 'businessName'>>) => Promise<void>;
  updateCleaner: (data: Partial<Pick<CleanerProfile, 'specialties' | 'workZoneCenter' | 'workZoneRadiusKm' | 'workZoneLabel' | 'availability' | 'bio'>>) => Promise<void>;
  uploadPhoto: (uri: string) => Promise<void>;
  removePhoto: () => Promise<void>;
  reset: () => void;
}

export type ProfileStore = ProfileState & ProfileActions;

// ─── Initial State ───────────────────────────────────────────────────────────

const initialState: ProfileState = {
  profile: null,
  isLoading: false,
  error: null,
};

// ─── Store ───────────────────────────────────────────────────────────────────

export const useProfileStore = create<ProfileStore>((set, get) => ({
  ...initialState,

  fetchProfile: async () => {
    set({ isLoading: true, error: null });

    try {
      const client = await getApiClient();
      const response = await client.get<FullProfile>(ENDPOINTS.PROFILE);
      set({ profile: response.data, isLoading: false });
    } catch (err) {
      set({ error: extractErrorMessage(err, ERROR_KEYS.FETCH_PROFILE), isLoading: false });
    }
  },

  fetchCompleteness: async () => {
    try {
      const client = await getApiClient();
      const response = await client.get<ProfileCompleteness>(ENDPOINTS.COMPLETENESS);
      const current = get().profile;

      if (current) {
        set({ profile: { ...current, completeness: response.data } });
      }
    } catch {
      // Silent failure — completeness is non-critical UI enhancement
    }
  },

  updateCommon: async (data) => {
    set({ error: null });

    try {
      const client = await getApiClient();
      const response = await client.patch<CommonProfile>(ENDPOINTS.PROFILE, data);
      const current = get().profile;

      if (current) {
        set({ profile: { ...current, common: response.data } });
      }
    } catch (err) {
      const message = extractErrorMessage(err, ERROR_KEYS.UPDATE_COMMON);
      set({ error: message });
      throw err;
    }
  },

  updateHost: async (data) => {
    set({ error: null });

    try {
      const client = await getApiClient();
      const response = await client.patch<HostProfile>(ENDPOINTS.HOST, data);
      const current = get().profile;

      if (current) {
        set({ profile: { ...current, host: response.data } });
      }
    } catch (err) {
      const message = extractErrorMessage(err, ERROR_KEYS.UPDATE_HOST);
      set({ error: message });
      throw err;
    }
  },

  updateCleaner: async (data) => {
    set({ error: null });

    try {
      const client = await getApiClient();
      const response = await client.patch<CleanerProfile>(ENDPOINTS.CLEANER, data);
      const current = get().profile;

      if (current) {
        set({ profile: { ...current, cleaner: response.data } });
      }
    } catch (err) {
      const message = extractErrorMessage(err, ERROR_KEYS.UPDATE_CLEANER);
      set({ error: message });
      throw err;
    }
  },

  uploadPhoto: async (uri) => {
    set({ error: null });

    try {
      const client = await getApiClient();
      const formData = new FormData();

      formData.append('file', {
        uri,
        type: 'image/jpeg',
        name: 'profile.jpg',
      } as unknown as Blob);

      const response = await client.post<{ photoUrl: string }>(
        ENDPOINTS.PHOTO,
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: PROFILE_PHOTO.UPLOAD_TIMEOUT_MS,
        },
      );

      const current = get().profile;

      if (current) {
        set({
          profile: {
            ...current,
            common: { ...current.common, photoUrl: response.data.photoUrl },
          },
        });
      }
    } catch (err) {
      const message = extractErrorMessage(err, ERROR_KEYS.UPLOAD_PHOTO);
      set({ error: message });
      throw err;
    }
  },

  removePhoto: async () => {
    set({ error: null });

    try {
      const client = await getApiClient();
      await client.delete(ENDPOINTS.PHOTO);

      const current = get().profile;

      if (current) {
        set({
          profile: {
            ...current,
            common: { ...current.common, photoUrl: null },
          },
        });
      }
    } catch (err) {
      const message = extractErrorMessage(err, ERROR_KEYS.REMOVE_PHOTO);
      set({ error: message });
      throw err;
    }
  },

  reset: () => {
    set(initialState);
  },
}));

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Convenience hook that returns all profile store state and actions.
 */
export function useProfile(): ProfileStore {
  return useProfileStore();
}

export default useProfile;
