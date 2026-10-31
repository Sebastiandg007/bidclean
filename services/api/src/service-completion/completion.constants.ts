/**
 * service-completion configuration, queue/consumer names, and fail-fast validation (Spec 20).
 *
 * Every tunable comes from the environment with a documented default — nothing money-affecting is
 * hardcoded in logic. `validateServiceCompletionConfig()` runs at startup (skipped under
 * NODE_ENV=test) and throws the full batch of invalid values so a misconfigured deployment never
 * boots. NO Stripe keys live here: money authority stays entirely in Spec 9.
 */

/** Parse an env integer with a default; kept private so callers read the named constants only. */
function envInt(name: string, fallback: string): number {
  return parseInt(process.env[name] ?? fallback, 10);
}

/** Auto-release window (ms) added to the finish time; snapshotted per completion at creation (24h). */
export const SERVICE_AUTO_RELEASE_WINDOW_MS = envInt('SERVICE_AUTO_RELEASE_WINDOW_MS', '86400000');

/** Auto-release sweep interval (ms) between bounded, repeatable passes. */
export const SERVICE_COMPLETION_SWEEP_INTERVAL_MS = envInt(
  'SERVICE_COMPLETION_SWEEP_INTERVAL_MS',
  '60000',
);

/** Max completions processed per auto-release sweep pass (bounded, idempotent). */
export const SERVICE_COMPLETION_SWEEP_BATCH_SIZE = envInt('SERVICE_COMPLETION_SWEEP_BATCH_SIZE', '100');

/** Release-intent drain interval (ms) between bounded, repeatable passes. */
export const SERVICE_COMPLETION_RELEASE_INTENT_INTERVAL_MS = envInt(
  'SERVICE_COMPLETION_RELEASE_INTENT_INTERVAL_MS',
  '15000',
);

/** Max intents drained per release-intent pass (bounded, idempotent). */
export const SERVICE_COMPLETION_RELEASE_INTENT_BATCH_SIZE = envInt(
  'SERVICE_COMPLETION_RELEASE_INTENT_BATCH_SIZE',
  '100',
);

/**
 * The claim lease (ms) held on an intent when a worker marks it DISPATCHED. A DISPATCHED intent is
 * durably re-claimable once its `lease_until` (= dispatched_at + this) passes, giving an orphaned
 * (crashed) dispatch a real recovery path. MUST exceed the drain interval so a live, in-flight
 * dispatch is never stolen by a concurrent drain pass.
 */
export const SERVICE_COMPLETION_RELEASE_INTENT_LEASE_MS = envInt(
  'SERVICE_COMPLETION_RELEASE_INTENT_LEASE_MS',
  '60000',
);

/** Interval (ms) between checklist_completed drain passes that create completions. */
export const SERVICE_COMPLETION_CREATION_DRAIN_INTERVAL_MS = envInt(
  'SERVICE_COMPLETION_CREATION_DRAIN_INTERVAL_MS',
  '15000',
);

/** Max checklist_completed rows drained per creation pass (bounded, idempotent). */
export const SERVICE_COMPLETION_CREATION_DRAIN_BATCH_SIZE = envInt(
  'SERVICE_COMPLETION_CREATION_DRAIN_BATCH_SIZE',
  '100',
);

/** Rating floor (default 1). */
export const SERVICE_RATING_MIN_STARS = envInt('SERVICE_RATING_MIN_STARS', '1');

/** Rating ceiling (default 5). */
export const SERVICE_RATING_MAX_STARS = envInt('SERVICE_RATING_MAX_STARS', '5');

/** The consumer name this module uses to drain `checklist_completed` over the checklist_outbox fan-out. */
export const COMPLETION_OUTBOX_CONSUMER_NAME = 'completion';

/** The physical outbox table + aggregate type owned by service-completion. */
export const COMPLETION_OUTBOX_TABLE = 'completion_outbox';
export const COMPLETION_AGGREGATE_TYPE = 'service_completion';

/** BullMQ queue name for the service-completion repeatable jobs (parity with siblings). */
export const SERVICE_COMPLETION_QUEUE_NAME = 'service-completion';

/** Default BullMQ job options: idempotent, self-healing repeatable jobs. */
export const SERVICE_COMPLETION_JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: true,
} as const;

/**
 * Fail-fast startup validation for service-completion configuration.
 *
 * Skipped under NODE_ENV=test (tests inject config directly), consistent with existing modules.
 * Throws with the full batch of invalid values so a misconfigured deployment never boots.
 */
export function validateServiceCompletionConfig(): void {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const errors: string[] = [];

  const positiveInts: ReadonlyArray<readonly [string, number]> = [
    ['SERVICE_AUTO_RELEASE_WINDOW_MS', SERVICE_AUTO_RELEASE_WINDOW_MS],
    ['SERVICE_COMPLETION_SWEEP_INTERVAL_MS', SERVICE_COMPLETION_SWEEP_INTERVAL_MS],
    ['SERVICE_COMPLETION_SWEEP_BATCH_SIZE', SERVICE_COMPLETION_SWEEP_BATCH_SIZE],
    ['SERVICE_COMPLETION_RELEASE_INTENT_INTERVAL_MS', SERVICE_COMPLETION_RELEASE_INTENT_INTERVAL_MS],
    ['SERVICE_COMPLETION_RELEASE_INTENT_BATCH_SIZE', SERVICE_COMPLETION_RELEASE_INTENT_BATCH_SIZE],
    ['SERVICE_COMPLETION_RELEASE_INTENT_LEASE_MS', SERVICE_COMPLETION_RELEASE_INTENT_LEASE_MS],
    ['SERVICE_COMPLETION_CREATION_DRAIN_INTERVAL_MS', SERVICE_COMPLETION_CREATION_DRAIN_INTERVAL_MS],
    ['SERVICE_COMPLETION_CREATION_DRAIN_BATCH_SIZE', SERVICE_COMPLETION_CREATION_DRAIN_BATCH_SIZE],
  ];
  for (const [name, value] of positiveInts) {
    if (!Number.isInteger(value) || value <= 0) {
      errors.push(`${name} must be a positive integer, got ${value}`);
    }
  }

  // A lease shorter than the drain interval could let a concurrent pass reclaim a still-live dispatch.
  if (
    Number.isInteger(SERVICE_COMPLETION_RELEASE_INTENT_LEASE_MS) &&
    Number.isInteger(SERVICE_COMPLETION_RELEASE_INTENT_INTERVAL_MS) &&
    SERVICE_COMPLETION_RELEASE_INTENT_LEASE_MS <= SERVICE_COMPLETION_RELEASE_INTENT_INTERVAL_MS
  ) {
    errors.push(
      'SERVICE_COMPLETION_RELEASE_INTENT_LEASE_MS must be greater than ' +
        `SERVICE_COMPLETION_RELEASE_INTENT_INTERVAL_MS (${SERVICE_COMPLETION_RELEASE_INTENT_LEASE_MS} <= ${SERVICE_COMPLETION_RELEASE_INTENT_INTERVAL_MS})`,
    );
  }

  if (
    !Number.isInteger(SERVICE_RATING_MIN_STARS) ||
    !Number.isInteger(SERVICE_RATING_MAX_STARS) ||
    !(1 <= SERVICE_RATING_MIN_STARS && SERVICE_RATING_MIN_STARS <= SERVICE_RATING_MAX_STARS && SERVICE_RATING_MAX_STARS <= 5)
  ) {
    errors.push(
      `SERVICE_RATING_MIN_STARS/SERVICE_RATING_MAX_STARS must satisfy 1 <= min <= max <= 5, got ${SERVICE_RATING_MIN_STARS}/${SERVICE_RATING_MAX_STARS}`,
    );
  }

  if (errors.length > 0) {
    throw new Error(`Invalid service-completion configuration:\n- ${errors.join('\n- ')}`);
  }
}
