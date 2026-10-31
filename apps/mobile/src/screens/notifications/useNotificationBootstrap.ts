/**
 * useNotificationBootstrap — after auth, request permission, init the OneSignal SDK, obtain the
 * player id, and register the device with the backend (consent reflecting the OS permission).
 *
 * Permission-denied is handled gracefully: the device is registered with `consentGranted=false`
 * (so it is never targeted) and an i18n explanation can be surfaced — the app never crashes and is
 * never blocked. The OneSignal SDK is injected (seam) so this is fully testable without a native dep.
 */

import { useCallback, useEffect } from 'react';
import { Platform } from 'react-native';

import { useNotificationsStore } from './notifications.store';
import { ONESIGNAL_APP_ID } from './notifications.constants';
import type { OneSignalSdk } from './onesignal.sdk';
import type { NotificationPlatform } from './notifications.types';

/** Map the RN platform to the backend registry platform code. */
function resolvePlatform(): NotificationPlatform {
  if (Platform.OS === 'ios') {
    return 'IOS';
  }
  if (Platform.OS === 'android') {
    return 'ANDROID';
  }
  return 'WEB';
}

/**
 * Run the notification bootstrap once for an authenticated user. Returns a manual `run` for tests
 * and screens that need to re-trigger registration (e.g. after the user enables notifications).
 */
export function useNotificationBootstrap(sdk: OneSignalSdk, isAuthenticated: boolean): { run: () => Promise<void> } {
  const setDevice = useNotificationsStore((state) => state.setDevice);
  const registerDevice = useNotificationsStore((state) => state.registerDevice);

  const run = useCallback(async () => {
    if (!ONESIGNAL_APP_ID) {
      return; // No public app id configured — nothing to initialize.
    }
    sdk.initialize(ONESIGNAL_APP_ID);

    const permission = await sdk.requestPermission();
    const playerId = await sdk.getPlayerId();
    setDevice(playerId, permission);

    if (playerId === null) {
      return; // No subscription id yet; a later re-run (or SDK callback) will register.
    }
    // Register even when denied: consentGranted=false so the device is never targeted (Model B),
    // and the app is never blocked. Consent flips true only when the OS permission is granted.
    await registerDevice(playerId, resolvePlatform(), permission === 'granted');
  }, [sdk, setDevice, registerDevice]);

  useEffect(() => {
    if (isAuthenticated) {
      void run();
    }
  }, [isAuthenticated, run]);

  return { run };
}
