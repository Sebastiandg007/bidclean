/**
 * Unit tests for the notifications Zustand store (Task 14.4).
 * Feature: push-notifications — foreground de-dup (P10 client side), device/preference actions.
 *
 * The notifications API is mocked here; the store owns no transport beyond those calls.
 */

import { useNotificationsStore } from '../notifications.store';
import {
  registerDeviceRequest,
  updateConsentRequest,
  getPreferencesRequest,
  updatePreferencesRequest,
} from '../notifications.api';

jest.mock('../notifications.api', () => ({
  registerDeviceRequest: jest.fn(),
  updateConsentRequest: jest.fn(),
  unregisterDeviceRequest: jest.fn(),
  getPreferencesRequest: jest.fn(),
  updatePreferencesRequest: jest.fn(),
}));

const mockedRegister = registerDeviceRequest as jest.MockedFunction<typeof registerDeviceRequest>;
const mockedConsent = updateConsentRequest as jest.MockedFunction<typeof updateConsentRequest>;
const mockedGetPrefs = getPreferencesRequest as jest.MockedFunction<typeof getPreferencesRequest>;
const mockedUpdatePrefs = updatePreferencesRequest as jest.MockedFunction<typeof updatePreferencesRequest>;

describe('useNotificationsStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useNotificationsStore.getState().reset();
  });

  it('registers a device and records the player id', async () => {
    mockedRegister.mockResolvedValue(undefined);
    await useNotificationsStore.getState().registerDevice('p1', 'IOS', true);
    expect(mockedRegister).toHaveBeenCalledWith({ onesignalPlayerId: 'p1', platform: 'IOS', consentGranted: true });
    expect(useNotificationsStore.getState().playerId).toBe('p1');
  });

  it('surfaces an i18n error key when consent update fails', async () => {
    mockedConsent.mockRejectedValue(new Error('network'));
    await useNotificationsStore.getState().updateConsent('p1', false);
    expect(useNotificationsStore.getState().error).toBe('notifications.error.consent');
  });

  it('loads and saves preferences', async () => {
    const prefs = { categoryOptOut: { offers: false }, quietHoursStart: null, quietHoursEnd: null, quietHoursTimezone: null, language: 'es' };
    mockedGetPrefs.mockResolvedValue(prefs);
    mockedUpdatePrefs.mockResolvedValue(undefined);

    await useNotificationsStore.getState().loadPreferences();
    expect(useNotificationsStore.getState().preferences).toEqual(prefs);

    await useNotificationsStore.getState().savePreferences({ ...prefs, language: 'en' });
    expect(mockedUpdatePrefs).toHaveBeenCalled();
    expect(useNotificationsStore.getState().preferences.language).toBe('en');
  });

  it('P10 (client): foreground de-dup is idempotent and fail-open', () => {
    const store = useNotificationsStore.getState();
    // Not seen -> not suppressed.
    expect(store.shouldSuppressPush('offer_matched:o1', 'offer_matched')).toBe(false);

    store.recordForegroundEvent('offer_matched:o1');
    store.recordForegroundEvent('offer_matched:o1'); // idempotent
    expect(useNotificationsStore.getState().shouldSuppressPush('offer_matched:o1', 'offer_matched')).toBe(true);

    // Messages and calls ALWAYS fail open, even if seen in-foreground.
    const s = useNotificationsStore.getState();
    s.recordForegroundEvent('new_message:c1');
    s.recordForegroundEvent('incoming_call:call1');
    expect(useNotificationsStore.getState().shouldSuppressPush('new_message:c1', 'new_message')).toBe(false);
    expect(useNotificationsStore.getState().shouldSuppressPush('incoming_call:call1', 'incoming_call')).toBe(false);
  });
});
