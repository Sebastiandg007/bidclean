/**
 * notifications.store — Zustand store for the push-notifications feature (one store per domain).
 *
 * Holds device/permission state, the user's preferences, and foreground-coordination bookkeeping.
 * Foreground de-dup is CLIENT-PREFERRED and FAIL-OPEN: when a realtime (Centrifugo) alert for an
 * event is shown while the app is foregrounded, the event key is recorded here so a redundant push
 * for the SAME event can be dismissed locally. It never suppresses a push whose event was not seen
 * in-foreground, and `message`/`call` pushes are always allowed through (fail-open).
 */

import { create } from 'zustand';

import {
  getPreferencesRequest,
  registerDeviceRequest,
  unregisterDeviceRequest,
  updateConsentRequest,
  updatePreferencesRequest,
} from './notifications.api';
import type {
  NotificationPlatform,
  NotificationPreferences,
  PermissionStatus,
} from './notifications.types';

/** Deep-link types that ALWAYS surface a push even if seen in-foreground (fail-open). */
const ALWAYS_DELIVER_TYPES = new Set(['new_message', 'incoming_call']);

const DEFAULT_PREFERENCES: NotificationPreferences = {
  categoryOptOut: {},
  quietHoursStart: null,
  quietHoursEnd: null,
  quietHoursTimezone: null,
  language: null,
};

export interface NotificationsState {
  readonly playerId: string | null;
  readonly permission: PermissionStatus;
  readonly preferences: NotificationPreferences;
  /** Event keys recently shown in-foreground (for client-side push de-dup). */
  readonly foregroundSeenEventKeys: ReadonlySet<string>;
  readonly isSavingPreferences: boolean;
  readonly error: string | null;
}

export interface NotificationsActions {
  /** Record the resolved OS permission + player id. */
  setDevice: (playerId: string | null, permission: PermissionStatus) => void;
  /** Register/upsert the device with the backend (consent reflects OS permission). */
  registerDevice: (playerId: string, platform: NotificationPlatform, consentGranted: boolean) => Promise<void>;
  /** Update this device's consent. */
  updateConsent: (playerId: string, consentGranted: boolean) => Promise<void>;
  /** Unregister this device (logout). */
  unregisterDevice: (playerId: string) => Promise<void>;
  /** Load preferences from the backend. */
  loadPreferences: () => Promise<void>;
  /** Persist preferences to the backend. */
  savePreferences: (preferences: NotificationPreferences) => Promise<void>;
  /** Record an event shown in-foreground so a redundant push for it is dismissed locally. */
  recordForegroundEvent: (eventKey: string) => void;
  /**
   * Decide whether an incoming push should be shown. Fail-open: only suppress when the SAME event
   * was reliably shown in-foreground AND it is not an always-deliver type (messages/calls).
   */
  shouldSuppressPush: (eventKey: string, deepLinkType: string) => boolean;
  clearError: () => void;
  reset: () => void;
}

export type NotificationsStore = NotificationsState & NotificationsActions;

const initialState: NotificationsState = {
  playerId: null,
  permission: 'undetermined',
  preferences: DEFAULT_PREFERENCES,
  foregroundSeenEventKeys: new Set<string>(),
  isSavingPreferences: false,
  error: null,
};

export const useNotificationsStore = create<NotificationsStore>((set, get) => ({
  ...initialState,

  setDevice: (playerId, permission) => {
    set({ playerId, permission });
  },

  registerDevice: async (playerId, platform, consentGranted) => {
    try {
      await registerDeviceRequest({ onesignalPlayerId: playerId, platform, consentGranted });
      set({ playerId, error: null });
    } catch {
      set({ error: 'notifications.error.register' });
    }
  },

  updateConsent: async (playerId, consentGranted) => {
    try {
      await updateConsentRequest(playerId, consentGranted);
    } catch {
      set({ error: 'notifications.error.consent' });
    }
  },

  unregisterDevice: async (playerId) => {
    try {
      await unregisterDeviceRequest(playerId);
      set({ playerId: null });
    } catch {
      set({ error: 'notifications.error.unregister' });
    }
  },

  loadPreferences: async () => {
    try {
      const preferences = await getPreferencesRequest();
      set({ preferences, error: null });
    } catch {
      set({ error: 'notifications.error.loadPreferences' });
    }
  },

  savePreferences: async (preferences) => {
    set({ isSavingPreferences: true, error: null });
    try {
      await updatePreferencesRequest(preferences);
      set({ preferences, isSavingPreferences: false });
    } catch {
      set({ isSavingPreferences: false, error: 'notifications.error.savePreferences' });
    }
  },

  recordForegroundEvent: (eventKey) => {
    const next = new Set(get().foregroundSeenEventKeys);
    next.add(eventKey);
    set({ foregroundSeenEventKeys: next });
  },

  shouldSuppressPush: (eventKey, deepLinkType) => {
    if (ALWAYS_DELIVER_TYPES.has(deepLinkType)) {
      return false; // messages/calls always fail open
    }
    return get().foregroundSeenEventKeys.has(eventKey);
  },

  clearError: () => set({ error: null }),

  reset: () => set({ ...initialState, foregroundSeenEventKeys: new Set<string>() }),
}));

export function useNotifications(): NotificationsStore {
  return useNotificationsStore();
}

export default useNotifications;
