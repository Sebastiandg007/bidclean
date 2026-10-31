import {
  NotificationCategory,
  NotificationType,
} from './notifications.types';

/**
 * notifications module configuration constants.
 *
 * Every tunable derives from an environment variable with a sensible default. Secrets and business
 * values are NEVER hardcoded in logic; production startup validation ({@link validateNotificationsConfig})
 * fails fast on any missing/invalid required value.
 *
 * `ONESIGNAL_*` are SHARED with the legacy offer-scoped push path — this module reuses them rather
 * than introducing divergent variables. The REST API key is server-only and never reaches the client.
 */

/** OneSignal application id (public; the same id the mobile client uses via EXPO_PUBLIC_*). */
export const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID ?? '';

/** OneSignal REST API key (SERVER-ONLY — never sent to the client). */
export const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY ?? '';

/** OneSignal REST base URL (overridable for testing). */
export const ONESIGNAL_API_URL =
  process.env.ONESIGNAL_API_URL ?? 'https://onesignal.com/api/v1';

/** HTTP timeout for OneSignal requests in milliseconds. */
export const ONESIGNAL_TIMEOUT_MS = parseInt(
  process.env.ONESIGNAL_TIMEOUT_MS ?? '10000',
  10,
);

/** HMAC signing secret for OneSignal webhook authentication (over the raw body). */
export const ONESIGNAL_WEBHOOK_SECRET = process.env.ONESIGNAL_WEBHOOK_SECRET ?? '';

/** Max accepted webhook age in seconds (replay guard for the signed timestamp). */
export const ONESIGNAL_WEBHOOK_TOLERANCE_SECONDS = parseInt(
  process.env.ONESIGNAL_WEBHOOK_TOLERANCE_SECONDS ?? '300',
  10,
);

/** BullMQ max delivery attempts before a ledger row becomes FAILED_FINAL. */
export const NOTIFICATIONS_DELIVERY_MAX_ATTEMPTS = parseInt(
  process.env.NOTIFICATIONS_DELIVERY_MAX_ATTEMPTS ?? '5',
  10,
);

/** BullMQ backoff base delay between delivery retries (ms). */
export const NOTIFICATIONS_DELIVERY_BACKOFF_MS = parseInt(
  process.env.NOTIFICATIONS_DELIVERY_BACKOFF_MS ?? '5000',
  10,
);

/** Outbox relay drain interval (ms, default 5 s). */
export const NOTIFICATIONS_RELAY_INTERVAL_MS = parseInt(
  process.env.NOTIFICATIONS_RELAY_INTERVAL_MS ?? '5000',
  10,
);

/** Rows drained per relay pass per outbox table. */
export const NOTIFICATIONS_RELAY_BATCH_SIZE = parseInt(
  process.env.NOTIFICATIONS_RELAY_BATCH_SIZE ?? '100',
  10,
);

/** Registry <-> OneSignal reconciliation sweep interval (ms, default 15 min). */
export const NOTIFICATIONS_RECONCILE_INTERVAL_MS = parseInt(
  process.env.NOTIFICATIONS_RECONCILE_INTERVAL_MS ?? '900000',
  10,
);

/** Devices processed per reconciliation sweep. */
export const NOTIFICATIONS_RECONCILE_BATCH_SIZE = parseInt(
  process.env.NOTIFICATIONS_RECONCILE_BATCH_SIZE ?? '100',
  10,
);

/** Retention window (days) beyond which terminal ledger/outbox rows are hard-pruned. */
export const NOTIFICATIONS_RETENTION_DAYS = parseInt(
  process.env.NOTIFICATIONS_RETENTION_DAYS ?? '90',
  10,
);

/** BullMQ queue names owned by the notifications module. */
export const NOTIFICATIONS_QUEUE_NAMES = {
  DELIVERY: 'notifications-delivery',
} as const;

/** BullMQ job names. */
export const NOTIFICATIONS_JOB_NAMES = {
  DELIVER: 'deliver-notification',
} as const;

/** Backoff strategy for delivery retries. */
export const NOTIFICATIONS_BACKOFF_TYPE = 'exponential';

/**
 * Default BullMQ job options for the delivery queue: retry with exponential backoff, keep failed
 * jobs for dead-letter inspection so no PENDING intent is silently lost.
 */
export const NOTIFICATIONS_DELIVERY_JOB_OPTIONS = {
  attempts: NOTIFICATIONS_DELIVERY_MAX_ATTEMPTS,
  backoff: {
    type: NOTIFICATIONS_BACKOFF_TYPE,
    delay: NOTIFICATIONS_DELIVERY_BACKOFF_MS,
  },
  removeOnComplete: true,
  removeOnFail: false,
} as const;

/**
 * Default per-category enablement, applied when a user has no preference row / no override for a
 * category. Transactional/urgent categories default ON; there is currently no marketing category
 * (journeys are configured OneSignal-side). Kept in config, never branched-on in logic — the
 * per-type authority is the {@link NotificationType} registry `defaultEnabled`.
 */
export const NOTIFICATIONS_DEFAULT_CATEGORY_ENABLED: Record<NotificationCategory, boolean> = {
  [NotificationCategory.OFFERS]: true,
  [NotificationCategory.PAYMENTS]: true,
  [NotificationCategory.NEGOTIATION]: true,
  [NotificationCategory.MESSAGES]: true,
  [NotificationCategory.CALLS]: true,
};

/**
 * Config-driven per-type metadata source. Loaded by {@link NotificationTypeRegistry}; kept here so
 * NO literals live in decision logic. `call-invited` is HIGH + EXEMPT (a ringing call must reach
 * the user regardless of quiet hours / non-urgent opt-outs).
 */
export const NOTIFICATION_TYPE_METADATA: Record<
  NotificationType,
  {
    readonly priority: 'HIGH' | 'NORMAL' | 'LOW';
    readonly category: NotificationCategory;
    readonly quietHoursBehavior: 'RESPECT' | 'EXEMPT';
    readonly defaultEnabled: boolean;
  }
> = {
  [NotificationType.OFFER_MATCHED]: {
    priority: 'HIGH',
    category: NotificationCategory.OFFERS,
    quietHoursBehavior: 'RESPECT',
    defaultEnabled: true,
  },
  [NotificationType.OFFER_CANCELLED]: {
    priority: 'NORMAL',
    category: NotificationCategory.OFFERS,
    quietHoursBehavior: 'RESPECT',
    defaultEnabled: true,
  },
  [NotificationType.OFFER_EXPIRED]: {
    priority: 'LOW',
    category: NotificationCategory.OFFERS,
    quietHoursBehavior: 'RESPECT',
    defaultEnabled: true,
  },
  [NotificationType.OFFER_COMPLETED]: {
    priority: 'NORMAL',
    category: NotificationCategory.OFFERS,
    quietHoursBehavior: 'RESPECT',
    defaultEnabled: true,
  },
  [NotificationType.PAYMENT_CAPTURED]: {
    priority: 'NORMAL',
    category: NotificationCategory.PAYMENTS,
    quietHoursBehavior: 'RESPECT',
    defaultEnabled: true,
  },
  [NotificationType.PAYMENT_RELEASED]: {
    priority: 'HIGH',
    category: NotificationCategory.PAYMENTS,
    quietHoursBehavior: 'RESPECT',
    defaultEnabled: true,
  },
  [NotificationType.PAYMENT_FAILED]: {
    priority: 'HIGH',
    category: NotificationCategory.PAYMENTS,
    quietHoursBehavior: 'RESPECT',
    defaultEnabled: true,
  },
  [NotificationType.PAYMENT_REFUNDED]: {
    priority: 'NORMAL',
    category: NotificationCategory.PAYMENTS,
    quietHoursBehavior: 'RESPECT',
    defaultEnabled: true,
  },
  [NotificationType.PAYMENT_DISPUTED]: {
    priority: 'HIGH',
    category: NotificationCategory.PAYMENTS,
    quietHoursBehavior: 'RESPECT',
    defaultEnabled: true,
  },
  [NotificationType.NEGOTIATION_PROPOSAL_CREATED]: {
    priority: 'NORMAL',
    category: NotificationCategory.NEGOTIATION,
    quietHoursBehavior: 'RESPECT',
    defaultEnabled: true,
  },
  [NotificationType.NEGOTIATION_PROPOSAL_COUNTERED]: {
    priority: 'NORMAL',
    category: NotificationCategory.NEGOTIATION,
    quietHoursBehavior: 'RESPECT',
    defaultEnabled: true,
  },
  [NotificationType.NEGOTIATION_PROPOSAL_REJECTED]: {
    priority: 'NORMAL',
    category: NotificationCategory.NEGOTIATION,
    quietHoursBehavior: 'RESPECT',
    defaultEnabled: true,
  },
  [NotificationType.NEGOTIATION_PROPOSAL_ACCEPTED]: {
    priority: 'HIGH',
    category: NotificationCategory.NEGOTIATION,
    quietHoursBehavior: 'RESPECT',
    defaultEnabled: true,
  },
  [NotificationType.MESSAGE_CREATED]: {
    priority: 'NORMAL',
    category: NotificationCategory.MESSAGES,
    quietHoursBehavior: 'RESPECT',
    defaultEnabled: true,
  },
  [NotificationType.CALL_INVITED]: {
    priority: 'HIGH',
    category: NotificationCategory.CALLS,
    quietHoursBehavior: 'EXEMPT',
    defaultEnabled: true,
  },
};

/**
 * Fail-fast startup validation for notifications configuration.
 *
 * Skipped under NODE_ENV=test (tests inject config / mock the client), consistent with existing
 * modules. Collects and throws on the first batch of invalid values so a misconfigured deployment
 * never boots.
 */
export function validateNotificationsConfig(): void {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const errors: string[] = [];

  if (!ONESIGNAL_APP_ID.trim()) {
    errors.push('ONESIGNAL_APP_ID must be a non-empty string');
  }
  if (!ONESIGNAL_API_KEY.trim()) {
    errors.push('ONESIGNAL_API_KEY must be a non-empty string');
  }
  if (!ONESIGNAL_API_URL.trim()) {
    errors.push('ONESIGNAL_API_URL must be a non-empty string');
  }
  if (!ONESIGNAL_WEBHOOK_SECRET.trim()) {
    errors.push('ONESIGNAL_WEBHOOK_SECRET must be a non-empty string');
  }

  const positiveInts: ReadonlyArray<readonly [string, number]> = [
    ['ONESIGNAL_TIMEOUT_MS', ONESIGNAL_TIMEOUT_MS],
    ['ONESIGNAL_WEBHOOK_TOLERANCE_SECONDS', ONESIGNAL_WEBHOOK_TOLERANCE_SECONDS],
    ['NOTIFICATIONS_DELIVERY_MAX_ATTEMPTS', NOTIFICATIONS_DELIVERY_MAX_ATTEMPTS],
    ['NOTIFICATIONS_DELIVERY_BACKOFF_MS', NOTIFICATIONS_DELIVERY_BACKOFF_MS],
    ['NOTIFICATIONS_RELAY_INTERVAL_MS', NOTIFICATIONS_RELAY_INTERVAL_MS],
    ['NOTIFICATIONS_RELAY_BATCH_SIZE', NOTIFICATIONS_RELAY_BATCH_SIZE],
    ['NOTIFICATIONS_RECONCILE_INTERVAL_MS', NOTIFICATIONS_RECONCILE_INTERVAL_MS],
    ['NOTIFICATIONS_RECONCILE_BATCH_SIZE', NOTIFICATIONS_RECONCILE_BATCH_SIZE],
    ['NOTIFICATIONS_RETENTION_DAYS', NOTIFICATIONS_RETENTION_DAYS],
  ];
  for (const [name, value] of positiveInts) {
    if (!Number.isInteger(value) || value <= 0) {
      errors.push(`${name} must be a positive integer, got ${value}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid notifications configuration:\n- ${errors.join('\n- ')}`);
  }
}
