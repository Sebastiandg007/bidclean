/**
 * notifications.constants — endpoints, deep-link route map, i18n keys, and OneSignal app id.
 *
 * Endpoints mirror the backend notifications controllers. The public OneSignal app id comes from
 * `EXPO_PUBLIC_ONESIGNAL_APP_ID` — the REST key NEVER reaches the client. The deep-link route map
 * translates a push `data.type` into an in-app route + reconcile hint (ids only).
 */

/** Backend REST endpoints for the notifications feature. */
export const NOTIFICATION_ENDPOINTS = {
  DEVICES: '/notifications/devices',
  deviceConsent: (playerId: string): string => `/notifications/devices/${playerId}/consent`,
  device: (playerId: string): string => `/notifications/devices/${playerId}`,
  PREFERENCES: '/notifications/preferences',
} as const;

/** Public OneSignal application id (never the REST key). */
export const ONESIGNAL_APP_ID = process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ?? '';

/** Navigation route name for the notification settings screen. */
export const NOTIFICATION_SETTINGS_ROUTE = 'NotificationSettings';

/** Logical categories the settings screen can toggle (parity with the backend). */
export const NOTIFICATION_CATEGORIES = ['offers', 'payments', 'negotiation', 'messages', 'calls'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/**
 * Deep-link `type` -> the in-app target route it should open. `incoming_call` opens the Spec 15
 * incoming-call sheet; all others navigate to the owning module's screen where authoritative state
 * is reconciled via GET.
 */
export const DEEP_LINK_ROUTES: Record<string, string> = {
  offer_matched: 'Radar',
  offer_cancelled: 'Radar',
  offer_expired: 'Radar',
  offer_completed: 'Radar',
  payment_captured: 'Payments',
  payment_released: 'Payments',
  payment_failed: 'Payments',
  payment_refunded: 'Payments',
  payment_disputed: 'Payments',
  negotiation_created: 'Negotiation',
  negotiation_countered: 'Negotiation',
  negotiation_rejected: 'Negotiation',
  negotiation_accepted: 'Negotiation',
  new_message: 'Chat',
  incoming_call: 'IncomingCall',
} as const;

/** i18n namespace + keys for the notifications UI (en/es parity). */
export const NOTIFICATIONS_I18N_NAMESPACE = 'notifications';

export const NOTIFICATIONS_I18N_KEYS = {
  SETTINGS_TITLE: 'notifications.settings.title',
  CATEGORIES_TITLE: 'notifications.settings.categoriesTitle',
  QUIET_HOURS_TITLE: 'notifications.settings.quietHoursTitle',
  QUIET_HOURS_START: 'notifications.settings.quietHoursStart',
  QUIET_HOURS_END: 'notifications.settings.quietHoursEnd',
  SAVE: 'notifications.settings.save',
  SAVED: 'notifications.settings.saved',
  SAVE_ERROR: 'notifications.settings.saveError',
  PERMISSION_DENIED_TITLE: 'notifications.permission.deniedTitle',
  PERMISSION_DENIED_BODY: 'notifications.permission.deniedBody',
  CATEGORY: {
    offers: 'notifications.category.offers',
    payments: 'notifications.category.payments',
    negotiation: 'notifications.category.negotiation',
    messages: 'notifications.category.messages',
    calls: 'notifications.category.calls',
  },
} as const;
