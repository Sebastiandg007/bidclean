/**
 * dispute-system configuration, queue/consumer names, and table names (Spec 21).
 *
 * Every tunable comes from the environment with a documented default — nothing money-affecting is
 * hardcoded in logic. Fail-fast validation lives in `config/validate-dispute-config.ts` and runs at
 * startup (skipped under NODE_ENV=test). NO Stripe keys live here: money authority stays entirely
 * in Spec 9; this module only durably enqueues an action Spec 9 executes. MinIO credentials are read
 * from the shared `MINIO_*` config by the storage service (server-only, shipped only as time-boxed
 * pre-signed URLs).
 */

/** Parse an env integer with a default; kept private so callers read the named constants only. */
function envInt(name: string, fallback: string): number {
  return parseInt(process.env[name] ?? fallback, 10);
}

/** Parse a comma-separated env list into a trimmed, non-empty string array. */
function envList(name: string, fallback: string): readonly string[] {
  return (process.env[name] ?? fallback)
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

// ─── Windows / SLA (snapshotted per dispute at creation) ─────────────────────────

/** Evidence submission window (ms); snapshotted onto each dispute at creation (default 48h). */
export const DISPUTE_EVIDENCE_WINDOW_MS = envInt('DISPUTE_EVIDENCE_WINDOW_MS', '172800000');

/** Resolution SLA (ms); snapshotted onto each dispute at creation (default 7 days). */
export const DISPUTE_RESOLUTION_SLA_MS = envInt('DISPUTE_RESOLUTION_SLA_MS', '604800000');

/**
 * The outcome the SLA sweep applies on expiry (documented, policy-defined). One of
 * `FAVOR_CLEANER/FAVOR_HOST/PARTIAL`. Default `FAVOR_CLEANER` (release the held funds to the Cleaner
 * — the platform does not punish a Cleaner for an operator's failure to resolve in time).
 */
export const DISPUTE_FALLBACK_RESOLUTION = process.env.DISPUTE_FALLBACK_RESOLUTION ?? 'FAVOR_CLEANER';

/**
 * The requested refund amount (cents) the fallback uses when `DISPUTE_FALLBACK_RESOLUTION=PARTIAL`.
 * Ignored for `FAVOR_CLEANER`/`FAVOR_HOST`. Spec 9 still ceilings the effective amount.
 */
export const DISPUTE_FALLBACK_PARTIAL_REFUND_CENTS = envInt(
  'DISPUTE_FALLBACK_PARTIAL_REFUND_CENTS',
  '0',
);

// ─── Reason codes + initiation policy ────────────────────────────────────────────

/** Allowed reason codes (app-validated). */
export const DISPUTE_REASON_CODES = envList(
  'DISPUTE_REASON_CODES',
  'QUALITY_INCOMPLETE,QUALITY_DAMAGE,NOT_AS_DESCRIBED,NO_SHOW,PAYOUT_NOT_RELEASED,WRONGFUL_REFUND',
);

/**
 * The allowed `(role:reason_code:phase)` initiation combinations, server-enforced. A raw
 * env string of `ROLE:REASON:PHASE` tuples (or `ROLE:REASON:*` for any phase), comma-separated.
 * Default: the Host may raise any configured quality/no-show grievance pre or post release; the
 * Cleaner may only raise a payout/non-release grievance (never a quality dispute against self).
 */
export const DISPUTE_INITIATION_POLICY = envList(
  'DISPUTE_INITIATION_POLICY',
  [
    'HOST:QUALITY_INCOMPLETE:*',
    'HOST:QUALITY_DAMAGE:*',
    'HOST:NOT_AS_DESCRIBED:*',
    'HOST:NO_SHOW:*',
    'CLEANER:PAYOUT_NOT_RELEASED:*',
    'CLEANER:WRONGFUL_REFUND:*',
  ].join(','),
);

// ─── Evidence storage (MinIO, grant-gated) ───────────────────────────────────────

/** Private bucket for Host/Cleaner evidence photos. */
export const DISPUTE_EVIDENCE_MINIO_BUCKET =
  process.env.DISPUTE_EVIDENCE_MINIO_BUCKET ?? 'dispute-evidence';

/** Server-authoritative max evidence object size in bytes (default 10 MiB). */
export const DISPUTE_EVIDENCE_MAX_SIZE_BYTES = envInt('DISPUTE_EVIDENCE_MAX_SIZE_BYTES', '10485760');

/** Allowed image content-types for evidence photos. */
export const DISPUTE_EVIDENCE_ALLOWED_MIME_TYPES = envList(
  'DISPUTE_EVIDENCE_ALLOWED_MIME_TYPES',
  'image/jpeg,image/png,image/webp',
);

/** Max Host/Cleaner photos per dispute (server-enforced cap). */
export const DISPUTE_EVIDENCE_MAX_PER_DISPUTE = envInt('DISPUTE_EVIDENCE_MAX_PER_DISPUTE', '10');

/** Pre-signed PUT TTL (seconds). */
export const DISPUTE_EVIDENCE_UPLOAD_URL_TTL_SECONDS = envInt(
  'DISPUTE_EVIDENCE_UPLOAD_URL_TTL_SECONDS',
  '300',
);

/** Pre-signed GET TTL (seconds). */
export const DISPUTE_EVIDENCE_PLAYBACK_URL_TTL_SECONDS = envInt(
  'DISPUTE_EVIDENCE_PLAYBACK_URL_TTL_SECONDS',
  '300',
);

/** Single-use upload grant TTL (seconds). */
export const DISPUTE_EVIDENCE_UPLOAD_GRANT_TTL_SECONDS = envInt(
  'DISPUTE_EVIDENCE_UPLOAD_GRANT_TTL_SECONDS',
  '600',
);

/** Evidence retention horizon in days (clock from `uploaded_at`); only ever targets TERMINAL disputes. */
export const DISPUTE_EVIDENCE_RETENTION_DAYS = envInt('DISPUTE_EVIDENCE_RETENTION_DAYS', '90');

/** Audit buffer (ms) added on top of the evidence + resolution windows in the retention-floor check. */
export const DISPUTE_EVIDENCE_RETENTION_AUDIT_BUFFER_MS = envInt(
  'DISPUTE_EVIDENCE_RETENTION_AUDIT_BUFFER_MS',
  '2592000000',
);

// ─── SLA sweep tuning ────────────────────────────────────────────────────────────

/** SLA sweep interval (ms) between bounded, repeatable passes. */
export const DISPUTE_SLA_SWEEP_INTERVAL_MS = envInt('DISPUTE_SLA_SWEEP_INTERVAL_MS', '60000');

/** Max disputes processed per SLA sweep pass. */
export const DISPUTE_SLA_SWEEP_BATCH_SIZE = envInt('DISPUTE_SLA_SWEEP_BATCH_SIZE', '100');

// ─── Intent drain tuning (escrow-block + financial intents share these) ──────────

/** Intent drain interval (ms) between bounded, repeatable passes. */
export const DISPUTE_INTENT_DRAIN_INTERVAL_MS = envInt('DISPUTE_INTENT_DRAIN_INTERVAL_MS', '15000');

/** Max intents drained per pass (bounded, idempotent). */
export const DISPUTE_INTENT_DRAIN_BATCH_SIZE = envInt('DISPUTE_INTENT_DRAIN_BATCH_SIZE', '100');

/**
 * Claim lease (ms) held on an intent when a worker marks it DISPATCHED. A crash-orphaned DISPATCHED
 * intent is re-claimable once its `lease_until` passes. MUST exceed `DISPUTE_INTENT_DRAIN_INTERVAL_MS`
 * so a live in-flight dispatch is never stolen by a concurrent drain pass.
 */
export const DISPUTE_INTENT_LEASE_MS = envInt('DISPUTE_INTENT_LEASE_MS', '60000');

// ─── Consumer / creation drain tuning ────────────────────────────────────────────

/** Interval (ms) between `service_disputed` drain passes that create disputes. */
export const DISPUTE_CREATION_DRAIN_INTERVAL_MS = envInt(
  'DISPUTE_CREATION_DRAIN_INTERVAL_MS',
  '15000',
);

/** Max `service_disputed` rows drained per creation pass. */
export const DISPUTE_CREATION_DRAIN_BATCH_SIZE = envInt('DISPUTE_CREATION_DRAIN_BATCH_SIZE', '100');

// ─── Retention / tombstone / stale-grant cleanup tuning ──────────────────────────

/** Retention + tombstone-drain sweep interval (ms). */
export const DISPUTE_CLEANUP_INTERVAL_MS = envInt('DISPUTE_CLEANUP_INTERVAL_MS', '3600000');

/** Max objects processed per retention/tombstone pass. */
export const DISPUTE_CLEANUP_BATCH_SIZE = envInt('DISPUTE_CLEANUP_BATCH_SIZE', '100');

/** Stale-grant cleanup sweep interval (ms). */
export const DISPUTE_STALE_GRANT_INTERVAL_MS = envInt('DISPUTE_STALE_GRANT_INTERVAL_MS', '600000');

/** Max stale grants processed per pass. */
export const DISPUTE_STALE_GRANT_BATCH_SIZE = envInt('DISPUTE_STALE_GRANT_BATCH_SIZE', '100');

// ─── Names / identifiers ─────────────────────────────────────────────────────────

/** The role that authorizes a user to resolve a dispute (an operator/admin role, app-validated). */
export const DISPUTE_RESOLVER_ROLE = process.env.DISPUTE_RESOLVER_ROLE ?? 'operator';

/** The consumer name this module uses to drain `service_disputed` over the completion_outbox fan-out. */
export const DISPUTE_OUTBOX_CONSUMER_NAME = 'dispute';

/** The completion_outbox event type this module reacts to (owned by Spec 20). */
export const SERVICE_DISPUTED_EVENT_TYPE = 'service_disputed';

/** The physical fan-out outbox table (Spec 20) this module consumes. */
export const COMPLETION_OUTBOX_TABLE = 'completion_outbox';

/** The per-consumer ack checkpoint table over completion_outbox (created by this module's migration). */
export const COMPLETION_OUTBOX_CONSUMERS_TABLE = 'completion_outbox_consumers';

/** The physical outbox table + aggregate type owned by dispute-system. */
export const DISPUTE_OUTBOX_TABLE = 'dispute_outbox';
export const DISPUTE_AGGREGATE_TYPE = 'dispute';

/** BullMQ queue name for the dispute-system repeatable jobs (parity with siblings). */
export const DISPUTE_QUEUE_NAME = 'dispute-system';

/** Default BullMQ job options: idempotent, self-healing repeatable jobs. */
export const DISPUTE_JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: true,
} as const;

/** Milliseconds per day (retention math). */
export const MS_PER_DAY = 86400000;
