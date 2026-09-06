/**
 * onesignal.sdk — a thin seam over the OneSignal push SDK.
 *
 * The concrete native SDK (`react-native-onesignal`) is integrated at the app shell and injected
 * here; this interface keeps the store, bootstrap, and routing testable without a native dependency
 * (tests provide a fake). The client only ever uses the PUBLIC app id; the REST key is server-only.
 */

import type { NotificationDeepLink, PermissionStatus, ReceivedPush } from './notifications.types';

/** The minimal OneSignal surface the notifications feature depends on. */
export interface OneSignalSdk {
  /** Initialize the SDK with the public app id (idempotent). */
  initialize(appId: string): void;
  /** Request OS notification permission; resolves to the resulting status. */
  requestPermission(): Promise<PermissionStatus>;
  /** The current OS permission status without prompting. */
  getPermissionStatus(): Promise<PermissionStatus>;
  /** The device's OneSignal player id (subscription id), or null when unavailable. */
  getPlayerId(): Promise<string | null>;
  /** Subscribe to notification-opened events (deep-link tap). Returns an unsubscribe fn. */
  onNotificationOpened(handler: (push: ReceivedPush) => void): () => void;
  /** Subscribe to foreground notification-received events. Returns an unsubscribe fn. */
  onForegroundReceived(handler: (push: ReceivedPush) => void): () => void;
}

/**
 * Build a normalized `ReceivedPush` from an arbitrary OneSignal notification's additionalData.
 * `eventKey` is the stable dedup key the app uses for foreground coordination; the deep-link is
 * the id-based routing payload.
 */
export function toReceivedPush(additionalData: Record<string, unknown> | null | undefined): ReceivedPush {
  const data = (additionalData ?? {}) as Record<string, unknown>;
  const deepLink: NotificationDeepLink = { type: readString(data, 'type') ?? 'unknown' };
  for (const [key, value] of Object.entries(data)) {
    if (key !== 'type' && typeof value === 'string') {
      (deepLink as Record<string, string>)[key] = value;
    }
  }
  const idPart = Object.entries(deepLink)
    .filter(([k]) => k !== 'type')
    .map(([, v]) => v)
    .join(':');
  return { eventKey: `${deepLink.type}:${idPart}`, deepLink };
}

function readString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** A no-op SDK used until the native SDK is wired at the app shell (keeps the app booting). */
export const noopOneSignalSdk: OneSignalSdk = {
  initialize: () => undefined,
  requestPermission: async () => 'undetermined',
  getPermissionStatus: async () => 'undetermined',
  getPlayerId: async () => null,
  onNotificationOpened: () => () => undefined,
  onForegroundReceived: () => () => undefined,
};
