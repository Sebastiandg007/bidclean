/**
 * Unit tests for useNotificationBootstrap (Task 14.4).
 * Feature: push-notifications — permission-denied registers with consent=false, never crashes.
 *
 * A fake OneSignal SDK is injected (the seam), so no native module is needed. The notifications
 * API is mocked. EXPO_PUBLIC_ONESIGNAL_APP_ID is set before importing the constant path.
 */

import { renderHook } from '@testing-library/react-native';

// EXPO_PUBLIC_* vars are statically inlined by babel-preset-expo at transform time, so the runtime
// process.env cannot seed ONESIGNAL_APP_ID. Mock the constants module to provide a deterministic id
// (preserving the other exports the hook and store rely on).
jest.mock('../notifications.constants', () => ({
  ...jest.requireActual('../notifications.constants'),
  ONESIGNAL_APP_ID: 'test-onesignal-app-id',
}));

import { useNotificationBootstrap } from '../useNotificationBootstrap';
import { useNotificationsStore } from '../notifications.store';
import { registerDeviceRequest } from '../notifications.api';
import type { OneSignalSdk } from '../onesignal.sdk';
import type { PermissionStatus } from '../notifications.types';

jest.mock('../notifications.api', () => ({
  registerDeviceRequest: jest.fn().mockResolvedValue(undefined),
  updateConsentRequest: jest.fn(),
  unregisterDeviceRequest: jest.fn(),
  getPreferencesRequest: jest.fn(),
  updatePreferencesRequest: jest.fn(),
}));

const mockedRegister = registerDeviceRequest as jest.MockedFunction<typeof registerDeviceRequest>;

function fakeSdk(permission: PermissionStatus, playerId: string | null): jest.Mocked<OneSignalSdk> {
  return {
    initialize: jest.fn(),
    requestPermission: jest.fn().mockResolvedValue(permission),
    getPermissionStatus: jest.fn().mockResolvedValue(permission),
    getPlayerId: jest.fn().mockResolvedValue(playerId),
    onNotificationOpened: jest.fn().mockReturnValue(() => undefined),
    onForegroundReceived: jest.fn().mockReturnValue(() => undefined),
  };
}

describe('useNotificationBootstrap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useNotificationsStore.getState().reset();
  });

  it('registers with consent=true when permission is granted', async () => {
    const sdk = fakeSdk('granted', 'player-A');
    const { result } = renderHook(() => useNotificationBootstrap(sdk, true));
    await result.current.run();
    expect(sdk.initialize).toHaveBeenCalledWith('test-onesignal-app-id');
    expect(mockedRegister).toHaveBeenCalledWith(
      expect.objectContaining({ onesignalPlayerId: 'player-A', consentGranted: true }),
    );
  });

  it('permission denied -> registers with consent=false and never crashes', async () => {
    const sdk = fakeSdk('denied', 'player-B');
    const { result } = renderHook(() => useNotificationBootstrap(sdk, true));
    await expect(result.current.run()).resolves.toBeUndefined();
    expect(mockedRegister).toHaveBeenCalledWith(
      expect.objectContaining({ onesignalPlayerId: 'player-B', consentGranted: false }),
    );
  });

  it('no player id -> records device state but does not register', async () => {
    const sdk = fakeSdk('granted', null);
    const { result } = renderHook(() => useNotificationBootstrap(sdk, true));
    await result.current.run();
    expect(mockedRegister).not.toHaveBeenCalled();
    expect(useNotificationsStore.getState().permission).toBe('granted');
  });
});
