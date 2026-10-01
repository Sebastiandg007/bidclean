/**
 * checklist-photos configuration constants (Spec 19).
 *
 * Every tunable derives from an environment variable with a sensible default; no secret, limit, or
 * policy is hardcoded in logic. Startup validation ({@link validateChecklistPhotosConfig}) fails
 * fast on any missing/invalid required value so a misconfigured deployment never boots — mirrors
 * `validateVoiceNotesConfig` / `validateServiceTrackingConfig`. Skipped under NODE_ENV=test (tests
 * inject config directly and run with MinIO/BullMQ/Redis mocked).
 *
 * Storage credentials (`MINIO_*`) are SHARED with existing modules and are NOT redeclared here;
 * `ChecklistStorageService` reads them via `ConfigService`, shipped to the client only as
 * time-boxed pre-signed URLs.
 */

import type {
  CompletionPrecondition,
  PhotoRequiredPolicy,
} from './checklist.types';

/** Parse an env integer with a default; kept private so callers read the named constants only. */
function envInt(name: string, fallback: string): number {
  return parseInt(process.env[name] ?? fallback, 10);
}

/** Dedicated MinIO bucket for checklist evidence photos (private, no public read). */
export const CHECKLIST_PHOTO_MINIO_BUCKET =
  process.env.CHECKLIST_PHOTO_MINIO_BUCKET ?? 'checklist-photos';

/** Maximum photo object size in bytes (server-observed size is authoritative). */
export const CHECKLIST_PHOTO_MAX_SIZE_BYTES = envInt(
  'CHECKLIST_PHOTO_MAX_SIZE_BYTES',
  '10485760',
);

/** Allowed image MIME types (parsed from a comma-separated env list). */
export const CHECKLIST_PHOTO_ALLOWED_MIME_TYPES: readonly string[] = (
  process.env.CHECKLIST_PHOTO_ALLOWED_MIME_TYPES ?? 'image/jpeg,image/png,image/webp,image/heic'
)
  .split(',')
  .map((mime) => mime.trim())
  .filter((mime) => mime.length > 0);

/** Maximum photos per task; snapshotted onto the run and enforced as a hard cap. */
export const CHECKLIST_PHOTO_MAX_PER_TASK = envInt('CHECKLIST_PHOTO_MAX_PER_TASK', '5');

/** Pre-signed PUT (upload) URL TTL in seconds. */
export const CHECKLIST_PHOTO_UPLOAD_URL_TTL_SECONDS = envInt(
  'CHECKLIST_PHOTO_UPLOAD_URL_TTL_SECONDS',
  '300',
);

/** Pre-signed GET (playback) URL TTL in seconds. */
export const CHECKLIST_PHOTO_PLAYBACK_URL_TTL_SECONDS = envInt(
  'CHECKLIST_PHOTO_PLAYBACK_URL_TTL_SECONDS',
  '300',
);

/** Single-use upload-grant TTL in seconds (binds an object key to run/task+user). */
export const CHECKLIST_PHOTO_UPLOAD_GRANT_TTL_SECONDS = envInt(
  'CHECKLIST_PHOTO_UPLOAD_GRANT_TTL_SECONDS',
  '600',
);

/** Evidence retention horizon in days (dispute window; clock from `uploaded_at`). */
export const CHECKLIST_PHOTO_RETENTION_DAYS = envInt('CHECKLIST_PHOTO_RETENTION_DAYS', '90');

/**
 * Task-level photo-required policy (which tasks need evidence to be marked/completed). Parsed from
 * config, snapshotted onto the run at IN_PROGRESS. `NONE` = no task requires a photo.
 */
export const CHECKLIST_PHOTO_REQUIRED_POLICY =
  process.env.CHECKLIST_PHOTO_REQUIRED_POLICY ?? 'NONE';

/**
 * Run-level completion precondition (what must hold to reach COMPLETED). Parsed from config,
 * snapshotted onto the run at IN_PROGRESS. `NONE` = any progress may complete.
 */
export const CHECKLIST_COMPLETION_PRECONDITION =
  process.env.CHECKLIST_COMPLETION_PRECONDITION ?? 'NONE';

/** Stuck-run sweep interval (ms) between repeatable ABANDONED-backstop passes. */
export const CHECKLIST_SWEEP_INTERVAL_MS = envInt('CHECKLIST_SWEEP_INTERVAL_MS', '60000');

/** Stuck-run sweep batch size per pass (bounded, idempotent). */
export const CHECKLIST_SWEEP_BATCH_SIZE = envInt('CHECKLIST_SWEEP_BATCH_SIZE', '100');

/** Retention/tombstone cleanup interval (ms) between repeatable passes. */
export const CHECKLIST_CLEANUP_INTERVAL_MS = envInt('CHECKLIST_CLEANUP_INTERVAL_MS', '300000');

/** Retention/tombstone cleanup batch size per pass (bounded, idempotent). */
export const CHECKLIST_CLEANUP_BATCH_SIZE = envInt('CHECKLIST_CLEANUP_BATCH_SIZE', '100');

/** Stale-upload-grant cleanup interval (ms) between repeatable passes. */
export const CHECKLIST_STALE_GRANT_INTERVAL_MS = envInt(
  'CHECKLIST_STALE_GRANT_INTERVAL_MS',
  '300000',
);

/** Stale-upload-grant cleanup batch size per pass (bounded, idempotent). */
export const CHECKLIST_STALE_GRANT_BATCH_SIZE = envInt('CHECKLIST_STALE_GRANT_BATCH_SIZE', '100');

/** Started-consumer drain batch size (upstream `service_started` over `service_outbox`). */
export const CHECKLIST_STARTED_DRAIN_BATCH_SIZE = envInt(
  'CHECKLIST_STARTED_DRAIN_BATCH_SIZE',
  '100',
);

/** Interval (ms) between started-consumer drains. */
export const CHECKLIST_STARTED_DRAIN_INTERVAL_MS = envInt(
  'CHECKLIST_STARTED_DRAIN_INTERVAL_MS',
  '5000',
);

/**
 * A session already terminal-for-tracking longer than this (ms) whose run is still ACTIVE (a
 * missed terminal signal) is force-ABANDONED by the stuck-run sweep. Defense-in-depth backstop.
 */
export const CHECKLIST_STUCK_RUN_THRESHOLD_MS = envInt(
  'CHECKLIST_STUCK_RUN_THRESHOLD_MS',
  '3600000',
);

/** BullMQ queue name for the checklist-photos cleanup/sweep jobs (reuses the shared Redis/BullMQ). */
export const CHECKLIST_CLEANUP_QUEUE_NAME = 'checklist-photos-cleanup';

/** The consumer name this module uses to drain `service_started` over the service_outbox fan-out. */
export const CHECKLIST_OUTBOX_CONSUMER_NAME = 'checklist';

/** Default BullMQ job options for the checklist cleanup queue: idempotent, self-healing sweeps. */
export const CHECKLIST_CLEANUP_JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: true,
} as const;

/**
 * Fail-fast startup validation for checklist-photos configuration.
 *
 * Skipped under NODE_ENV=test (tests inject config directly), consistent with existing modules.
 * Throws with the full batch of invalid values so a misconfigured deployment never boots.
 */
export function validateChecklistPhotosConfig(): void {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const errors: string[] = [];

  if (!CHECKLIST_PHOTO_MINIO_BUCKET.trim()) {
    errors.push('CHECKLIST_PHOTO_MINIO_BUCKET must be a non-empty string');
  }
  if (CHECKLIST_PHOTO_ALLOWED_MIME_TYPES.length === 0) {
    errors.push('CHECKLIST_PHOTO_ALLOWED_MIME_TYPES must list at least one image MIME type');
  }
  if (!isPhotoRequiredPolicy(CHECKLIST_PHOTO_REQUIRED_POLICY)) {
    errors.push(
      `CHECKLIST_PHOTO_REQUIRED_POLICY must be one of NONE|ALL_TASKS, got ${CHECKLIST_PHOTO_REQUIRED_POLICY}`,
    );
  }
  if (!isCompletionPrecondition(CHECKLIST_COMPLETION_PRECONDITION)) {
    errors.push(
      `CHECKLIST_COMPLETION_PRECONDITION must be one of NONE|ALL_TASKS_DONE|ALL_REQUIRED_PHOTOS, got ${CHECKLIST_COMPLETION_PRECONDITION}`,
    );
  }

  const positiveInts: ReadonlyArray<readonly [string, number]> = [
    ['CHECKLIST_PHOTO_MAX_SIZE_BYTES', CHECKLIST_PHOTO_MAX_SIZE_BYTES],
    ['CHECKLIST_PHOTO_MAX_PER_TASK', CHECKLIST_PHOTO_MAX_PER_TASK],
    ['CHECKLIST_PHOTO_UPLOAD_URL_TTL_SECONDS', CHECKLIST_PHOTO_UPLOAD_URL_TTL_SECONDS],
    ['CHECKLIST_PHOTO_PLAYBACK_URL_TTL_SECONDS', CHECKLIST_PHOTO_PLAYBACK_URL_TTL_SECONDS],
    ['CHECKLIST_PHOTO_UPLOAD_GRANT_TTL_SECONDS', CHECKLIST_PHOTO_UPLOAD_GRANT_TTL_SECONDS],
    ['CHECKLIST_PHOTO_RETENTION_DAYS', CHECKLIST_PHOTO_RETENTION_DAYS],
    ['CHECKLIST_SWEEP_INTERVAL_MS', CHECKLIST_SWEEP_INTERVAL_MS],
    ['CHECKLIST_SWEEP_BATCH_SIZE', CHECKLIST_SWEEP_BATCH_SIZE],
    ['CHECKLIST_CLEANUP_INTERVAL_MS', CHECKLIST_CLEANUP_INTERVAL_MS],
    ['CHECKLIST_CLEANUP_BATCH_SIZE', CHECKLIST_CLEANUP_BATCH_SIZE],
    ['CHECKLIST_STALE_GRANT_INTERVAL_MS', CHECKLIST_STALE_GRANT_INTERVAL_MS],
    ['CHECKLIST_STALE_GRANT_BATCH_SIZE', CHECKLIST_STALE_GRANT_BATCH_SIZE],
    ['CHECKLIST_STARTED_DRAIN_BATCH_SIZE', CHECKLIST_STARTED_DRAIN_BATCH_SIZE],
    ['CHECKLIST_STARTED_DRAIN_INTERVAL_MS', CHECKLIST_STARTED_DRAIN_INTERVAL_MS],
    ['CHECKLIST_STUCK_RUN_THRESHOLD_MS', CHECKLIST_STUCK_RUN_THRESHOLD_MS],
  ];
  for (const [name, value] of positiveInts) {
    if (!Number.isInteger(value) || value <= 0) {
      errors.push(`${name} must be a positive integer, got ${value}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid checklist-photos configuration:\n- ${errors.join('\n- ')}`);
  }
}

/** Whether a raw string is a supported photo-required policy. */
export function isPhotoRequiredPolicy(value: string): value is PhotoRequiredPolicy {
  return value === 'NONE' || value === 'ALL_TASKS';
}

/** Whether a raw string is a supported completion precondition. */
export function isCompletionPrecondition(value: string): value is CompletionPrecondition {
  return value === 'NONE' || value === 'ALL_TASKS_DONE' || value === 'ALL_REQUIRED_PHOTOS';
}
