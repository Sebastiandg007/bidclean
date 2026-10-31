/**
 * video-verification configuration constants (Spec 18).
 *
 * Every tunable derives from an environment variable with a sensible default; no secret, limit,
 * threshold, or business value is hardcoded in logic. Startup validation
 * ({@link validateVideoVerificationConfig}) fails fast on any missing/invalid required value so a
 * misconfigured deployment never boots — mirrors `validateVoiceNotesConfig`. Skipped under
 * NODE_ENV=test (tests inject config directly).
 *
 * Storage credentials (`MINIO_*`) and the service-to-service AI auth token (`AI_SERVICE_AUTH_TOKEN`)
 * are SHARED with existing modules and are NOT redeclared here; the storage service reads MinIO
 * credentials via `ConfigService`, and the face-verify client reads the AI token via `ConfigService`.
 * The AI service itself has NO storage credentials (Option A).
 */

/** Master switch. When false ⇒ verification created DISABLED, no grant/video/job (privacy-by-design). */
export const VIDEO_VERIFICATION_ENABLED =
  (process.env.VIDEO_VERIFICATION_ENABLED ?? 'true').toLowerCase() === 'true';

/** Dedicated MinIO bucket for arrival videos (private, server-side encrypted, no public read). */
export const VIDEO_VERIFICATION_MINIO_BUCKET =
  process.env.VIDEO_VERIFICATION_MINIO_BUCKET ?? 'verification-videos';

/** Maximum arrival-video object size in bytes (server-observed size is authoritative). */
export const VIDEO_VERIFICATION_MAX_SIZE_BYTES = parseInt(
  process.env.VIDEO_VERIFICATION_MAX_SIZE_BYTES ?? '15728640',
  10,
);

/** Maximum clip duration in milliseconds (server-observed duration is authoritative). */
export const VIDEO_VERIFICATION_MAX_DURATION_MS = parseInt(
  process.env.VIDEO_VERIFICATION_MAX_DURATION_MS ?? '15000',
  10,
);

/** Allowed video MIME types (parsed from a comma-separated env list). */
export const VIDEO_VERIFICATION_ALLOWED_MIME_TYPES: readonly string[] = (
  process.env.VIDEO_VERIFICATION_ALLOWED_MIME_TYPES ?? 'video/mp4,video/quicktime,video/webm'
)
  .split(',')
  .map((mime) => mime.trim())
  .filter((mime) => mime.length > 0);

/** Pre-signed PUT (upload) URL TTL in seconds. */
export const VIDEO_VERIFICATION_UPLOAD_URL_TTL_SECONDS = parseInt(
  process.env.VIDEO_VERIFICATION_UPLOAD_URL_TTL_SECONDS ?? '300',
  10,
);

/** Single-use upload-grant TTL in seconds (binds an object_key to session + Cleaner). */
export const VIDEO_VERIFICATION_UPLOAD_GRANT_TTL_SECONDS = parseInt(
  process.env.VIDEO_VERIFICATION_UPLOAD_GRANT_TTL_SECONDS ?? '600',
  10,
);

/** Decision threshold, snapshotted per verification; validated `0 < threshold <= 1` at load. */
export const VIDEO_VERIFICATION_MATCH_THRESHOLD = parseFloat(
  process.env.VIDEO_VERIFICATION_MATCH_THRESHOLD ?? '0.6',
);

/** AI/FastAPI base URL for the `/verify-face` endpoint (Option A: bytes, no storage ref). */
export const VIDEO_VERIFICATION_AI_URL = process.env.VIDEO_VERIFICATION_AI_URL ?? '';

/** AI call HTTP timeout in milliseconds. */
export const VIDEO_VERIFICATION_TIMEOUT_MS = parseInt(
  process.env.VIDEO_VERIFICATION_TIMEOUT_MS ?? '60000',
  10,
);

/** Bounded comparison retries before FAILED (BullMQ attempts + stuck-sweep re-enqueue bound). */
export const VIDEO_VERIFICATION_MAX_RETRIES = parseInt(
  process.env.VIDEO_VERIFICATION_MAX_RETRIES ?? '3',
  10,
);

/** Retention horizon in hours (default 24-48h; the retention clock starts at `uploaded_at`). */
export const VIDEO_VERIFICATION_RETENTION_HOURS = parseInt(
  process.env.VIDEO_VERIFICATION_RETENTION_HOURS ?? '48',
  10,
);

/** PENDING_UPLOAD expiry window in milliseconds (never-uploaded → EXPIRED). */
export const VIDEO_VERIFICATION_UPLOAD_WINDOW_MS = parseInt(
  process.env.VIDEO_VERIFICATION_UPLOAD_WINDOW_MS ?? '900000',
  10,
);

/** UPLOADED/PROCESSING stuck re-enqueue threshold in milliseconds. */
export const VIDEO_VERIFICATION_STUCK_THRESHOLD_MS = parseInt(
  process.env.VIDEO_VERIFICATION_STUCK_THRESHOLD_MS ?? '600000',
  10,
);

/** Sweep interval (ms) for the upload-window + stuck-processing sweeps. */
export const VIDEO_VERIFICATION_SWEEP_INTERVAL_MS = parseInt(
  process.env.VIDEO_VERIFICATION_SWEEP_INTERVAL_MS ?? '300000',
  10,
);

/** Sweep batch size per pass (bounded, idempotent). */
export const VIDEO_VERIFICATION_SWEEP_BATCH_SIZE = parseInt(
  process.env.VIDEO_VERIFICATION_SWEEP_BATCH_SIZE ?? '100',
  10,
);

/** Cleanup interval (ms) for the retention + tombstone-drain jobs. */
export const VIDEO_VERIFICATION_CLEANUP_INTERVAL_MS = parseInt(
  process.env.VIDEO_VERIFICATION_CLEANUP_INTERVAL_MS ?? '300000',
  10,
);

/** Cleanup batch size per pass (bounded, idempotent). */
export const VIDEO_VERIFICATION_CLEANUP_BATCH_SIZE = parseInt(
  process.env.VIDEO_VERIFICATION_CLEANUP_BATCH_SIZE ?? '100',
  10,
);

/** Bounded drain batch for the arrival-consumer over `service_outbox` (consumer_name='video'). */
export const VIDEO_VERIFICATION_ARRIVAL_DRAIN_BATCH_SIZE = parseInt(
  process.env.VIDEO_VERIFICATION_ARRIVAL_DRAIN_BATCH_SIZE ?? '100',
  10,
);

/** Interval (ms) for the arrival-consumer drain pass. */
export const VIDEO_VERIFICATION_ARRIVAL_DRAIN_INTERVAL_MS = parseInt(
  process.env.VIDEO_VERIFICATION_ARRIVAL_DRAIN_INTERVAL_MS ?? '5000',
  10,
);

/** BullMQ backoff base delay between comparison retries (ms). */
export const VIDEO_VERIFICATION_BACKOFF_DELAY_MS = parseInt(
  process.env.VIDEO_VERIFICATION_BACKOFF_DELAY_MS ?? '5000',
  10,
);

/** The `service_outbox` consumer name this module drains under (fan-out, per-consumer checkpoint). */
export const VIDEO_VERIFICATION_CONSUMER_NAME = 'video';

/** BullMQ queue name for the asynchronous face-comparison worker. */
export const VIDEO_VERIFICATION_COMPARISON_QUEUE_NAME = 'video-face-comparison';

/** BullMQ job name for a single face-comparison work item. */
export const VIDEO_VERIFICATION_COMPARISON_JOB_NAME = 'compare-arrival-face';

/**
 * Default BullMQ job options for the comparison queue: bounded retries with exponential backoff;
 * keep failed jobs for dead-letter inspection so a lost job is observable.
 */
export const VIDEO_VERIFICATION_COMPARISON_JOB_OPTIONS = {
  attempts: VIDEO_VERIFICATION_MAX_RETRIES,
  backoff: {
    type: 'exponential',
    delay: VIDEO_VERIFICATION_BACKOFF_DELAY_MS,
  },
  removeOnComplete: true,
  removeOnFail: false,
} as const;
