/**
 * service-tracking configuration constants (Spec 17).
 *
 * Every tunable derives from an environment variable with a sensible default; no secret or limit
 * is hardcoded in logic. Startup validation ({@link validateServiceTrackingConfig}) fails fast on
 * any missing/invalid required value so a misconfigured deployment never boots — mirrors
 * `validateChatConfig` / `validateVoipConfig`. Skipped under NODE_ENV=test (tests inject config
 * directly and run with Centrifugo/Redis/Postgres mocked).
 *
 * `CENTRIFUGO_TOKEN_SECRET` / `CENTRIFUGO_API_URL` / `CENTRIFUGO_API_KEY` are SHARED with the
 * existing Centrifugo integration (offers publishing, chat); this module reuses them rather than
 * introducing divergent variables. The Cleaner never publishes to the channel — the server is the
 * sole publisher (Option A) and the Host is a read-only subscriber; live position is ephemeral and
 * the only durable location datum is `arrival_distance_m`.
 */

/** Parse an env integer with a default; kept private so callers read the named constants only. */
function envInt(name: string, fallback: string): number {
  return parseInt(process.env[name] ?? fallback, 10);
}

/** Geofence radius (metres) snapshotted onto a session at creation (default ~50m). */
export const SERVICE_GEOFENCE_RADIUS_M = envInt('SERVICE_GEOFENCE_RADIUS_M', '50');

/** Server-side rate limit: min interval (ms) between accepted position samples per (user, session). */
export const SERVICE_POSITION_MIN_INTERVAL_MS = envInt('SERVICE_POSITION_MIN_INTERVAL_MS', '3000');

/** Eligibility gate: max reported accuracy (metres). A worse-accuracy sample is ineligible for arrival. */
export const SERVICE_POSITION_MAX_ACCURACY_M = envInt('SERVICE_POSITION_MAX_ACCURACY_M', '50');

/** Eligibility gate: max sample age (ms), i.e. `server_now - at`. An older sample is ineligible. */
export const SERVICE_POSITION_MAX_AGE_MS = envInt('SERVICE_POSITION_MAX_AGE_MS', '30000');

/** Eligibility gate: max tolerated future-dating (ms). `at > server_now + this` is ineligible. */
export const SERVICE_POSITION_MAX_CLOCK_SKEW_MS = envInt(
  'SERVICE_POSITION_MAX_CLOCK_SKEW_MS',
  '5000',
);

/** Channel namespace prefix for per-session channels: `service:session:{id}`. */
export const SERVICE_POSITION_CHANNEL_PREFIX =
  process.env.SERVICE_POSITION_CHANNEL_PREFIX ?? 'service:session:';

/** Session channel subscription token TTL (seconds) — bounded expiry. */
export const SERVICE_POSITION_TOKEN_TTL_SECONDS = envInt(
  'SERVICE_POSITION_TOKEN_TTL_SECONDS',
  '3600',
);

/** Stale window (ms): an EN_ROUTE session with no eligible progress within this is force-expired. */
export const SERVICE_EN_ROUTE_STALE_MS = envInt('SERVICE_EN_ROUTE_STALE_MS', '1800000');

/** Abandon window (ms): a session that never leaves MATCHED within this is force-expired. */
export const SERVICE_SESSION_ABANDON_MS = envInt('SERVICE_SESSION_ABANDON_MS', '3600000');

/** Sweep interval (ms) between repeatable force-expiry passes. */
export const SERVICE_SWEEP_INTERVAL_MS = envInt('SERVICE_SWEEP_INTERVAL_MS', '60000');

/** Sweep batch size per pass (bounded, idempotent). */
export const SERVICE_SWEEP_BATCH_SIZE = envInt('SERVICE_SWEEP_BATCH_SIZE', '100');

/** Batch size for the activation-consumer drain (upstream `service_activation_ready`). */
export const SERVICE_ACTIVATION_DRAIN_BATCH_SIZE = envInt(
  'SERVICE_ACTIVATION_DRAIN_BATCH_SIZE',
  '100',
);

/** Interval (ms) between activation-consumer drains. */
export const SERVICE_ACTIVATION_DRAIN_INTERVAL_MS = envInt(
  'SERVICE_ACTIVATION_DRAIN_INTERVAL_MS',
  '5000',
);

/** HMAC-SHA256 secret used to sign the session channel subscription token (server-side, shared). */
export const CENTRIFUGO_TOKEN_SECRET = process.env.CENTRIFUGO_TOKEN_SECRET ?? '';

/** BullMQ queue + repeatable job names for the service-tracking sweep. */
export const SERVICE_SWEEP_QUEUE_NAME = 'service-tracking-sweep';
export const SERVICE_SWEEP_JOB_NAME = 'service-tracking-sweep-job';

/**
 * Default BullMQ job options for the service-tracking sweep queue: the sweep is idempotent and
 * self-healing, so a failed pass is simply retried on the next repeatable tick.
 */
export const SERVICE_SWEEP_JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: true,
} as const;

/** Build the Centrifugo channel name for a session (server → Host output transport). */
export function serviceChannelForSession(sessionId: string): string {
  return `${SERVICE_POSITION_CHANNEL_PREFIX}${sessionId}`;
}

/** Extract the session id from a `service:session:{id}` channel, or null if malformed. */
export function sessionIdFromServiceChannel(channel: string): string | null {
  if (!channel.startsWith(SERVICE_POSITION_CHANNEL_PREFIX)) {
    return null;
  }
  const id = channel.slice(SERVICE_POSITION_CHANNEL_PREFIX.length);
  return id.length > 0 ? id : null;
}

/**
 * Fail-fast startup validation for service-tracking configuration.
 *
 * Skipped under NODE_ENV=test (tests inject config directly), consistent with existing modules.
 * Throws with the full batch of invalid values so a misconfigured deployment never boots.
 */
export function validateServiceTrackingConfig(): void {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const errors: string[] = [];

  if (!CENTRIFUGO_TOKEN_SECRET.trim()) {
    errors.push('CENTRIFUGO_TOKEN_SECRET must be a non-empty string');
  }
  if (!SERVICE_POSITION_CHANNEL_PREFIX.trim()) {
    errors.push('SERVICE_POSITION_CHANNEL_PREFIX must be a non-empty string');
  }

  const positiveInts: ReadonlyArray<readonly [string, number]> = [
    ['SERVICE_GEOFENCE_RADIUS_M', SERVICE_GEOFENCE_RADIUS_M],
    ['SERVICE_POSITION_MIN_INTERVAL_MS', SERVICE_POSITION_MIN_INTERVAL_MS],
    ['SERVICE_POSITION_MAX_ACCURACY_M', SERVICE_POSITION_MAX_ACCURACY_M],
    ['SERVICE_POSITION_MAX_AGE_MS', SERVICE_POSITION_MAX_AGE_MS],
    ['SERVICE_POSITION_MAX_CLOCK_SKEW_MS', SERVICE_POSITION_MAX_CLOCK_SKEW_MS],
    ['SERVICE_POSITION_TOKEN_TTL_SECONDS', SERVICE_POSITION_TOKEN_TTL_SECONDS],
    ['SERVICE_EN_ROUTE_STALE_MS', SERVICE_EN_ROUTE_STALE_MS],
    ['SERVICE_SESSION_ABANDON_MS', SERVICE_SESSION_ABANDON_MS],
    ['SERVICE_SWEEP_INTERVAL_MS', SERVICE_SWEEP_INTERVAL_MS],
    ['SERVICE_SWEEP_BATCH_SIZE', SERVICE_SWEEP_BATCH_SIZE],
    ['SERVICE_ACTIVATION_DRAIN_BATCH_SIZE', SERVICE_ACTIVATION_DRAIN_BATCH_SIZE],
    ['SERVICE_ACTIVATION_DRAIN_INTERVAL_MS', SERVICE_ACTIVATION_DRAIN_INTERVAL_MS],
  ];
  for (const [name, value] of positiveInts) {
    if (!Number.isInteger(value) || value <= 0) {
      errors.push(`${name} must be a positive integer, got ${value}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid service-tracking configuration:\n- ${errors.join('\n- ')}`);
  }
}
