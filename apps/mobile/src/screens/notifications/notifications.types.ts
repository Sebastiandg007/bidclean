/**
 * notifications.types — client-side types for the push-notifications feature.
 *
 * Mirrors the backend contract (deep-link shapes, preference payloads) without importing server
 * code. Deep-links are id-based ({ type, ...ids }) so the app routes and reconciles via GET.
 */

/** Per-device platform reported to the backend registry. */
export type NotificationPlatform = 'IOS' | 'ANDROID' | 'WEB';

/** The typed, id-based deep-link carried in a push `data` payload. */
export interface NotificationDeepLink {
  readonly type: string;
  readonly [id: string]: string;
}

/** A received push (normalized from the OneSignal SDK notification). */
export interface ReceivedPush {
  /** Deterministic event key used for client-side foreground de-dup. */
  readonly eventKey: string;
  readonly deepLink: NotificationDeepLink;
}

/** Per-category opt-out map ({ [category]: false } disables that category). */
export type CategoryOptOut = Record<string, boolean>;

/** The user's notification preferences (as read/written to the backend). */
export interface NotificationPreferences {
  readonly categoryOptOut: CategoryOptOut;
  readonly quietHoursStart: string | null;
  readonly quietHoursEnd: string | null;
  readonly quietHoursTimezone: string | null;
  readonly language: string | null;
}

/** Body sent to register/upsert a device. */
export interface RegisterDeviceRequest {
  readonly onesignalPlayerId: string;
  readonly platform: NotificationPlatform;
  readonly consentGranted: boolean;
}

/** OS notification permission outcome. */
export type PermissionStatus = 'granted' | 'denied' | 'undetermined';
