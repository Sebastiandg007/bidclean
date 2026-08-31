import { EntitlementKey } from './subscriptions.types';

/**
 * revenuecat-subscriptions configuration constants.
 *
 * Every configurable value derives from an environment variable with a sensible default.
 * Secrets and identifiers are NEVER hardcoded in logic; production startup validation
 * (see {@link validateSubscriptionsConfig}) fails fast on any missing/invalid value.
 *
 * `REVENUECAT_API_KEY` / `REVENUECAT_API_URL` are SHARED with the account-deletion cascade
 * (user-profile); this module reuses them rather than introducing divergent variables.
 */

/** RevenueCat secret REST key (server-side; shared with the deletion cascade). */
export const REVENUECAT_API_KEY = process.env.REVENUECAT_API_KEY ?? '';

/** RevenueCat REST base URL (pinned to a versioned path). */
export const REVENUECAT_API_URL =
  process.env.REVENUECAT_API_URL ?? 'https://api.revenuecat.com/v1';

/** HMAC-SHA256 webhook signing secret (preferred authentication). */
export const REVENUECAT_WEBHOOK_SIGNING_SECRET =
  process.env.REVENUECAT_WEBHOOK_SIGNING_SECRET ?? '';

/** Shared-secret bearer fallback, used only when the signing secret is absent. */
export const REVENUECAT_WEBHOOK_AUTH_SECRET =
  process.env.REVENUECAT_WEBHOOK_AUTH_SECRET ?? '';

/** Max accepted webhook age in seconds (replay guard for the HMAC timestamp). */
export const REVENUECAT_WEBHOOK_TOLERANCE_SECONDS = parseInt(
  process.env.REVENUECAT_WEBHOOK_TOLERANCE_SECONDS ?? '300',
  10,
);

/** Reconciliation sweep interval (ms, default 15 min). */
export const SUBSCRIPTION_RECONCILE_INTERVAL_MS = parseInt(
  process.env.SUBSCRIPTION_RECONCILE_INTERVAL_MS ?? '900000',
  10,
);

/** Staleness window for reconciliation + `/subscriptions/me` self-heal (ms, default 24 h). */
export const SUBSCRIPTION_STALE_WINDOW_MS = parseInt(
  process.env.SUBSCRIPTION_STALE_WINDOW_MS ?? '86400000',
  10,
);

/** Rows processed per reconciliation sweep. */
export const SUBSCRIPTION_RECONCILE_BATCH = parseInt(
  process.env.SUBSCRIPTION_RECONCILE_BATCH ?? '100',
  10,
);

/** Age before the recovery worker re-enqueues a RECEIVED/QUEUED ledger row (ms, default 60 s). */
export const SUBSCRIPTION_DISPATCH_GRACE_MS = parseInt(
  process.env.SUBSCRIPTION_DISPATCH_GRACE_MS ?? '60000',
  10,
);

/** BullMQ max retries for webhook processing before dead-letter. */
export const SUBSCRIPTION_MAX_RETRIES = parseInt(
  process.env.SUBSCRIPTION_MAX_RETRIES ?? '5',
  10,
);

/** BullMQ backoff base delay between retries (ms). */
export const SUBSCRIPTION_BACKOFF_DELAY_MS = parseInt(
  process.env.SUBSCRIPTION_BACKOFF_DELAY_MS ?? '5000',
  10,
);

/**
 * Logical entitlement key -> configured RevenueCat entitlement id (its `lookup_key`).
 * REQUIRED in production: there is NO hardcoded fallback id — a missing mapping fails startup.
 */
export const ENTITLEMENT_ID_MAP: Record<EntitlementKey, string> = {
  [EntitlementKey.CLEANER_PRO]: process.env.RC_ENTITLEMENT_CLEANER_PRO ?? '',
  [EntitlementKey.HOST_PRO]: process.env.RC_ENTITLEMENT_HOST_PRO ?? '',
  [EntitlementKey.AD_FREE]: process.env.RC_ENTITLEMENT_AD_FREE ?? '',
};

/** BullMQ queue + job names for async webhook processing. */
export const SUBSCRIPTION_QUEUE_NAME = 'subscriptions-revenuecat-webhook';
export const SUBSCRIPTION_JOB_NAME = 'process-revenuecat-event';

/**
 * Fail-fast startup validation for all subscription configuration.
 *
 * Skipped under NODE_ENV=test (tests inject config directly), consistent with existing modules.
 * Throws on the first batch of invalid values so a misconfigured deployment never boots.
 */
export function validateSubscriptionsConfig(): void {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const errors: string[] = [];

  if (!REVENUECAT_API_KEY.trim()) {
    errors.push('REVENUECAT_API_KEY must be a non-empty string');
  }

  if (!REVENUECAT_WEBHOOK_SIGNING_SECRET.trim() && !REVENUECAT_WEBHOOK_AUTH_SECRET.trim()) {
    errors.push(
      'At least one webhook secret is required ' +
        '(REVENUECAT_WEBHOOK_SIGNING_SECRET preferred, or REVENUECAT_WEBHOOK_AUTH_SECRET)',
    );
  }

  for (const key of Object.keys(ENTITLEMENT_ID_MAP) as EntitlementKey[]) {
    if (!ENTITLEMENT_ID_MAP[key].trim()) {
      errors.push(`ENTITLEMENT_ID_MAP[${key}] must map to a configured RevenueCat id (RC_ENTITLEMENT_${key})`);
    }
  }

  const positiveInts: ReadonlyArray<readonly [string, number]> = [
    ['REVENUECAT_WEBHOOK_TOLERANCE_SECONDS', REVENUECAT_WEBHOOK_TOLERANCE_SECONDS],
    ['SUBSCRIPTION_RECONCILE_INTERVAL_MS', SUBSCRIPTION_RECONCILE_INTERVAL_MS],
    ['SUBSCRIPTION_STALE_WINDOW_MS', SUBSCRIPTION_STALE_WINDOW_MS],
    ['SUBSCRIPTION_RECONCILE_BATCH', SUBSCRIPTION_RECONCILE_BATCH],
    ['SUBSCRIPTION_DISPATCH_GRACE_MS', SUBSCRIPTION_DISPATCH_GRACE_MS],
    ['SUBSCRIPTION_MAX_RETRIES', SUBSCRIPTION_MAX_RETRIES],
    ['SUBSCRIPTION_BACKOFF_DELAY_MS', SUBSCRIPTION_BACKOFF_DELAY_MS],
  ];
  for (const [name, value] of positiveInts) {
    if (!Number.isInteger(value) || value <= 0) {
      errors.push(`${name} must be a positive integer, got ${value}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid subscriptions configuration:\n- ${errors.join('\n- ')}`);
  }
}
