/**
 * Payments module constants.
 *
 * All configurable values derive from environment variables with sensible defaults.
 * Values are validated at startup (fail-fast) via `validatePaymentsConfig()` so a
 * misconfiguration never surfaces as a runtime error mid-payment.
 */

/** Stripe secret API key (server-side) */
export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? '';

/** Stripe publishable key (mobile SDK) */
export const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY ?? '';

/** Webhook signing secret used to verify Stripe signatures */
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';

/** Pinned Stripe API version */
export const STRIPE_API_VERSION = process.env.STRIPE_API_VERSION ?? '2024-06-20';

/** Connected account type (must be 'express') */
export const STRIPE_CONNECT_ACCOUNT_TYPE = process.env.STRIPE_CONNECT_ACCOUNT_TYPE ?? 'express';

/** Max accepted webhook age in seconds (replay guard) */
export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = Number(
  process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS ?? '300',
);

/** Express onboarding Account Link refresh URL */
export const STRIPE_ONBOARDING_REFRESH_URL = process.env.STRIPE_ONBOARDING_REFRESH_URL ?? '';

/** Express onboarding Account Link return URL */
export const STRIPE_ONBOARDING_RETURN_URL = process.env.STRIPE_ONBOARDING_RETURN_URL ?? '';

/** Hours funds are held before auto-release */
export const ESCROW_AUTO_RELEASE_HOURS = Number(process.env.ESCROW_AUTO_RELEASE_HOURS ?? '24');

/** Auto-release sweep interval in milliseconds */
export const PAYMENTS_AUTO_RELEASE_SWEEP_MS = Number(
  process.env.PAYMENTS_AUTO_RELEASE_SWEEP_MS ?? '300000',
);

/** Payment reconciliation interval in milliseconds */
export const PAYMENTS_RECONCILE_INTERVAL_MS = Number(
  process.env.PAYMENTS_RECONCILE_INTERVAL_MS ?? '600000',
);

/** Connected-account reconciliation interval in milliseconds */
export const CONNECT_RECONCILE_INTERVAL_MS = Number(
  process.env.CONNECT_RECONCILE_INTERVAL_MS ?? '900000',
);

/** Max BullMQ job retries */
export const PAYMENTS_MAX_RETRIES = Number(process.env.PAYMENTS_MAX_RETRIES ?? '5');

/** BullMQ retry backoff base delay in milliseconds */
export const PAYMENTS_BACKOFF_DELAY_MS = Number(process.env.PAYMENTS_BACKOFF_DELAY_MS ?? '5000');

/** BullMQ backoff strategy */
export const PAYMENTS_BACKOFF_TYPE = 'exponential';

/** BullMQ queue names */
export const PAYMENTS_QUEUE_NAMES = {
  WEBHOOK: 'payments-stripe-webhook',
  DEFERRED_RELEASE: 'payments-deferred-release',
} as const;

/** BullMQ job names */
export const PAYMENTS_JOB_NAMES = {
  PROCESS_WEBHOOK: 'process-webhook',
  DEFERRED_RELEASE: 'deferred-release',
} as const;

/** Supported currencies for payments (ISO 4217) */
export const SUPPORTED_CURRENCIES = ['COP', 'USD', 'CAD', 'EUR', 'GBP'] as const;

/** Node environment (used to relax secret checks in test) */
const NODE_ENV = process.env.NODE_ENV ?? 'development';

/**
 * Default BullMQ job options for payments queues. Retry with exponential backoff;
 * keep failed jobs for inspection (dead-letter handling).
 */
export const PAYMENTS_DEFAULT_JOB_OPTIONS = {
  attempts: PAYMENTS_MAX_RETRIES,
  backoff: {
    type: PAYMENTS_BACKOFF_TYPE,
    delay: PAYMENTS_BACKOFF_DELAY_MS,
  },
  removeOnComplete: true,
  removeOnFail: false,
} as const;

/**
 * Validate payments configuration at startup (fail-fast). Throws a descriptive error
 * if any value is out of range so the application fails to boot rather than
 * misbehaving while moving money.
 *
 * @throws Error if any configuration value is invalid
 */
export function validatePaymentsConfig(): void {
  const errors: string[] = [];
  const isTest = NODE_ENV === 'test';

  if (!isTest && STRIPE_SECRET_KEY.trim().length === 0) {
    errors.push('STRIPE_SECRET_KEY must be non-empty outside the test environment');
  }

  if (!isTest && STRIPE_WEBHOOK_SECRET.trim().length === 0) {
    errors.push('STRIPE_WEBHOOK_SECRET must be non-empty outside the test environment');
  }

  if (STRIPE_CONNECT_ACCOUNT_TYPE !== 'express') {
    errors.push(
      `STRIPE_CONNECT_ACCOUNT_TYPE must be 'express', got '${STRIPE_CONNECT_ACCOUNT_TYPE}'`,
    );
  }

  if (!Number.isInteger(STRIPE_WEBHOOK_TOLERANCE_SECONDS) || STRIPE_WEBHOOK_TOLERANCE_SECONDS <= 0) {
    errors.push(
      `STRIPE_WEBHOOK_TOLERANCE_SECONDS must be a positive integer, got ${STRIPE_WEBHOOK_TOLERANCE_SECONDS}`,
    );
  }

  if (!Number.isInteger(ESCROW_AUTO_RELEASE_HOURS) || ESCROW_AUTO_RELEASE_HOURS <= 0) {
    errors.push(
      `ESCROW_AUTO_RELEASE_HOURS must be a positive integer, got ${ESCROW_AUTO_RELEASE_HOURS}`,
    );
  }

  const positiveIntervals: Array<[string, number]> = [
    ['PAYMENTS_AUTO_RELEASE_SWEEP_MS', PAYMENTS_AUTO_RELEASE_SWEEP_MS],
    ['PAYMENTS_RECONCILE_INTERVAL_MS', PAYMENTS_RECONCILE_INTERVAL_MS],
    ['CONNECT_RECONCILE_INTERVAL_MS', CONNECT_RECONCILE_INTERVAL_MS],
    ['PAYMENTS_BACKOFF_DELAY_MS', PAYMENTS_BACKOFF_DELAY_MS],
  ];
  for (const [name, value] of positiveIntervals) {
    if (!Number.isInteger(value) || value <= 0) {
      errors.push(`${name} must be a positive integer, got ${value}`);
    }
  }

  if (!Number.isInteger(PAYMENTS_MAX_RETRIES) || PAYMENTS_MAX_RETRIES <= 0) {
    errors.push(`PAYMENTS_MAX_RETRIES must be a positive integer, got ${PAYMENTS_MAX_RETRIES}`);
  }

  // Connect onboarding URLs are required whenever Connect is enabled (always, here).
  if (!isTest && STRIPE_ONBOARDING_REFRESH_URL.trim().length === 0) {
    errors.push('STRIPE_ONBOARDING_REFRESH_URL must be set when Connect is enabled');
  }
  if (!isTest && STRIPE_ONBOARDING_RETURN_URL.trim().length === 0) {
    errors.push('STRIPE_ONBOARDING_RETURN_URL must be set when Connect is enabled');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid payments configuration:\n- ${errors.join('\n- ')}`);
  }
}
