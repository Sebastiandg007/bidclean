import {
  VIDEO_VERIFICATION_AI_URL,
  VIDEO_VERIFICATION_ALLOWED_MIME_TYPES,
  VIDEO_VERIFICATION_ARRIVAL_DRAIN_BATCH_SIZE,
  VIDEO_VERIFICATION_ARRIVAL_DRAIN_INTERVAL_MS,
  VIDEO_VERIFICATION_BACKOFF_DELAY_MS,
  VIDEO_VERIFICATION_CLEANUP_BATCH_SIZE,
  VIDEO_VERIFICATION_CLEANUP_INTERVAL_MS,
  VIDEO_VERIFICATION_ENABLED,
  VIDEO_VERIFICATION_MATCH_THRESHOLD,
  VIDEO_VERIFICATION_MAX_DURATION_MS,
  VIDEO_VERIFICATION_MAX_RETRIES,
  VIDEO_VERIFICATION_MAX_SIZE_BYTES,
  VIDEO_VERIFICATION_MINIO_BUCKET,
  VIDEO_VERIFICATION_RETENTION_HOURS,
  VIDEO_VERIFICATION_STUCK_THRESHOLD_MS,
  VIDEO_VERIFICATION_SWEEP_BATCH_SIZE,
  VIDEO_VERIFICATION_SWEEP_INTERVAL_MS,
  VIDEO_VERIFICATION_UPLOAD_GRANT_TTL_SECONDS,
  VIDEO_VERIFICATION_UPLOAD_URL_TTL_SECONDS,
  VIDEO_VERIFICATION_UPLOAD_WINDOW_MS,
} from '../video-verification.constants';

/**
 * The positive-integer tunables that must each be a strictly-positive integer at boot.
 * Kept as a data table so the validator stays a single small loop (SRP, ≤30 lines each).
 */
const POSITIVE_INT_TUNABLES: ReadonlyArray<readonly [string, number]> = [
  ['VIDEO_VERIFICATION_MAX_SIZE_BYTES', VIDEO_VERIFICATION_MAX_SIZE_BYTES],
  ['VIDEO_VERIFICATION_MAX_DURATION_MS', VIDEO_VERIFICATION_MAX_DURATION_MS],
  ['VIDEO_VERIFICATION_UPLOAD_URL_TTL_SECONDS', VIDEO_VERIFICATION_UPLOAD_URL_TTL_SECONDS],
  ['VIDEO_VERIFICATION_UPLOAD_GRANT_TTL_SECONDS', VIDEO_VERIFICATION_UPLOAD_GRANT_TTL_SECONDS],
  ['VIDEO_VERIFICATION_MAX_RETRIES', VIDEO_VERIFICATION_MAX_RETRIES],
  ['VIDEO_VERIFICATION_RETENTION_HOURS', VIDEO_VERIFICATION_RETENTION_HOURS],
  ['VIDEO_VERIFICATION_UPLOAD_WINDOW_MS', VIDEO_VERIFICATION_UPLOAD_WINDOW_MS],
  ['VIDEO_VERIFICATION_STUCK_THRESHOLD_MS', VIDEO_VERIFICATION_STUCK_THRESHOLD_MS],
  ['VIDEO_VERIFICATION_SWEEP_INTERVAL_MS', VIDEO_VERIFICATION_SWEEP_INTERVAL_MS],
  ['VIDEO_VERIFICATION_SWEEP_BATCH_SIZE', VIDEO_VERIFICATION_SWEEP_BATCH_SIZE],
  ['VIDEO_VERIFICATION_CLEANUP_INTERVAL_MS', VIDEO_VERIFICATION_CLEANUP_INTERVAL_MS],
  ['VIDEO_VERIFICATION_CLEANUP_BATCH_SIZE', VIDEO_VERIFICATION_CLEANUP_BATCH_SIZE],
  ['VIDEO_VERIFICATION_ARRIVAL_DRAIN_BATCH_SIZE', VIDEO_VERIFICATION_ARRIVAL_DRAIN_BATCH_SIZE],
  ['VIDEO_VERIFICATION_ARRIVAL_DRAIN_INTERVAL_MS', VIDEO_VERIFICATION_ARRIVAL_DRAIN_INTERVAL_MS],
  ['VIDEO_VERIFICATION_BACKOFF_DELAY_MS', VIDEO_VERIFICATION_BACKOFF_DELAY_MS],
];

/** Collect the non-numeric structural errors (bucket, MIME list, AI URL). */
function collectStructuralErrors(): string[] {
  const errors: string[] = [];
  if (!VIDEO_VERIFICATION_MINIO_BUCKET.trim()) {
    errors.push('VIDEO_VERIFICATION_MINIO_BUCKET must be a non-empty string');
  }
  if (VIDEO_VERIFICATION_ALLOWED_MIME_TYPES.length === 0) {
    errors.push('VIDEO_VERIFICATION_ALLOWED_MIME_TYPES must list at least one video MIME type');
  }
  if (VIDEO_VERIFICATION_ENABLED && !VIDEO_VERIFICATION_AI_URL.trim()) {
    errors.push('VIDEO_VERIFICATION_AI_URL must be non-empty when VIDEO_VERIFICATION_ENABLED=true');
  }
  return errors;
}

/** Collect the positive-integer + threshold-range errors. */
function collectNumericErrors(): string[] {
  const errors: string[] = [];
  for (const [name, value] of POSITIVE_INT_TUNABLES) {
    if (!Number.isInteger(value) || value <= 0) {
      errors.push(`${name} must be a positive integer, got ${value}`);
    }
  }
  if (
    !Number.isFinite(VIDEO_VERIFICATION_MATCH_THRESHOLD) ||
    VIDEO_VERIFICATION_MATCH_THRESHOLD <= 0 ||
    VIDEO_VERIFICATION_MATCH_THRESHOLD > 1
  ) {
    errors.push(
      `VIDEO_VERIFICATION_MATCH_THRESHOLD must satisfy 0 < t <= 1, got ${VIDEO_VERIFICATION_MATCH_THRESHOLD}`,
    );
  }
  return errors;
}

/**
 * Fail-fast startup validation for video-verification configuration.
 *
 * Skipped under NODE_ENV=test (tests inject config directly), consistent with existing modules.
 * Throws with the full batch of invalid values so a misconfigured deployment never boots. Rejects a
 * `match_threshold <= 0` or `> 1` so the snapshot and score always share the `[0, 1]` range.
 */
export function validateVideoVerificationConfig(): void {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  const errors = [...collectStructuralErrors(), ...collectNumericErrors()];
  if (errors.length > 0) {
    throw new Error(`Invalid video-verification configuration:\n- ${errors.join('\n- ')}`);
  }
}
