/**
 * useProfile — Zustand store hook + API calls for profile data.
 * Manages full private profile, completeness, and CRUD operations.
 * Fetches profile on app start, caches locally.
 */

// TODO: Implement in task 28

import type { FullProfile } from './profile.types';

/** Profile store state shape (placeholder for Zustand implementation) */
export interface ProfileState {
  profile: FullProfile | null;
  isLoading: boolean;
  error: string | null;
  fetchProfile: () => Promise<void>;
  updateCommon: (data: Partial<{ displayName: string; phoneNumber: string | null }>) => Promise<void>;
  updateHost: (data: Partial<{ businessName: string | null }>) => Promise<void>;
  updateCleaner: (data: Partial<{
    specialties: string[];
    workZoneCenter: { lat: number; lng: number };
    workZoneRadiusKm: number;
    workZoneLabel: string;
    availability: Record<string, unknown>;
    bio: string;
  }>) => Promise<void>;
  uploadPhoto: (uri: string) => Promise<void>;
  removePhoto: () => Promise<void>;
}

/**
 * Hook placeholder — will create Zustand store in task 28.
 */
export function useProfile(): ProfileState {
  // TODO: Create Zustand store with API integration
  throw new Error('useProfile not yet implemented — see task 28');
}

export default useProfile;
