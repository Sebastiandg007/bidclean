/**
 * useSettings — Settings store hook + backend sync.
 * Manages language, theme, and notification preferences.
 * Stores locally (offline access) and syncs to backend (cross-device).
 */

// TODO: Implement in task 30

import type { UserSettings } from './profile.types';

/** Settings store state shape (placeholder for Zustand implementation) */
export interface SettingsState {
  settings: UserSettings | null;
  isLoading: boolean;
  error: string | null;
  loadFromLocal: () => Promise<void>;
  updateSettings: (partial: Partial<UserSettings>) => Promise<void>;
  syncToBackend: () => Promise<void>;
}

/**
 * Hook placeholder — will create Zustand store in task 30.
 */
export function useSettings(): SettingsState {
  // TODO: Create Zustand store with SecureStore + API sync
  throw new Error('useSettings not yet implemented — see task 30');
}

export default useSettings;
