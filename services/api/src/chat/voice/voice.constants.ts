/**
 * voice-notes configuration constants (Spec 14).
 *
 * Every tunable derives from an environment variable with a sensible default; no secret or limit
 * is hardcoded in logic. Startup validation ({@link validateVoiceNotesConfig}) fails fast on any
 * missing/invalid required value so a misconfigured deployment never boots — mirrors
 * `validateChatConfig`. Skipped under NODE_ENV=test (tests inject config directly).
 *
 * Storage credentials (`MINIO_*`) and the service-to-service AI auth token (`AI_SERVICE_AUTH_TOKEN`)
 * are SHARED with existing modules and are NOT redeclared here; the storage service reads MinIO
 * credentials via `ConfigService`, and the Whisper client reads the AI token via `ConfigService`.
 */

/** Dedicated MinIO bucket for voice-note audio (private, no public read). */
export const MINIO_VOICE_NOTES_BUCKET =
  process.env.MINIO_VOICE_NOTES_BUCKET ?? 'chat-voice-notes';

/** Maximum clip duration in milliseconds (server-observed duration is authoritative). */
export const VOICE_MAX_DURATION_MS = parseInt(
  process.env.VOICE_MAX_DURATION_MS ?? '120000',
  10,
);

/** Maximum audio object size in bytes (server-observed size is authoritative). */
export const VOICE_MAX_SIZE_BYTES = parseInt(
  process.env.VOICE_MAX_SIZE_BYTES ?? '5242880',
  10,
);

/** Allowed audio MIME types (parsed from a comma-separated env list). */
export const VOICE_ALLOWED_MIME_TYPES: readonly string[] = (
  process.env.VOICE_ALLOWED_MIME_TYPES ??
  'audio/mp4,audio/aac,audio/mpeg,audio/ogg,audio/webm,audio/wav'
)
  .split(',')
  .map((mime) => mime.trim())
  .filter((mime) => mime.length > 0);

/** Pre-signed PUT (upload) URL TTL in seconds. */
export const VOICE_UPLOAD_URL_TTL_SECONDS = parseInt(
  process.env.VOICE_UPLOAD_URL_TTL_SECONDS ?? '300',
  10,
);

/** Pre-signed GET (playback) URL TTL in seconds. */
export const VOICE_PLAYBACK_URL_TTL_SECONDS = parseInt(
  process.env.VOICE_PLAYBACK_URL_TTL_SECONDS ?? '300',
  10,
);

/** Upload-grant TTL in seconds (binds an object_key to conversation+user, single-use). */
export const VOICE_UPLOAD_GRANT_TTL_SECONDS = parseInt(
  process.env.VOICE_UPLOAD_GRANT_TTL_SECONDS ?? '600',
  10,
);

/** Whether asynchronous transcription is enabled. When false, notes still send/play (DISABLED). */
export const VOICE_TRANSCRIPTION_ENABLED =
  (process.env.VOICE_TRANSCRIPTION_ENABLED ?? 'true').toLowerCase() === 'true';

/** Transcription HTTP timeout to the AI service (milliseconds). */
export const VOICE_TRANSCRIPTION_TIMEOUT_MS = parseInt(
  process.env.VOICE_TRANSCRIPTION_TIMEOUT_MS ?? '60000',
  10,
);

/** Bounded transcription retries (BullMQ attempts + stuck-PENDING sweep re-enqueue bound). */
export const VOICE_TRANSCRIPTION_MAX_RETRIES = parseInt(
  process.env.VOICE_TRANSCRIPTION_MAX_RETRIES ?? '3',
  10,
);

/** AI/FastAPI base URL for the Whisper transcription endpoint (Option A: bytes, no storage ref). */
export const VOICE_AI_SERVICE_URL = process.env.VOICE_AI_SERVICE_URL ?? '';

/** Cleanup/reconciliation sweep interval (milliseconds) for orphan grants/objects. */
export const VOICE_CLEANUP_INTERVAL_MS = parseInt(
  process.env.VOICE_CLEANUP_INTERVAL_MS ?? '300000',
  10,
);

/** Cleanup batch size per sweep pass (bounded, idempotent). */
export const VOICE_CLEANUP_BATCH_SIZE = parseInt(
  process.env.VOICE_CLEANUP_BATCH_SIZE ?? '100',
  10,
);

/** Re-enqueue a PENDING transcript older than this (milliseconds) — no PENDING-forever. */
export const VOICE_TRANSCRIPTION_STUCK_THRESHOLD_MS = parseInt(
  process.env.VOICE_TRANSCRIPTION_STUCK_THRESHOLD_MS ?? '600000',
  10,
);

/** Reconciler ignores bucket objects newer than this grace window (milliseconds). */
export const VOICE_ORPHAN_RECONCILE_GRACE_MS = parseInt(
  process.env.VOICE_ORPHAN_RECONCILE_GRACE_MS ?? '3600000',
  10,
);

/** BullMQ queue names for asynchronous voice-note processing. */
export const VOICE_TRANSCRIPTION_QUEUE_NAME = 'voice-notes-transcription';
export const VOICE_TRANSCRIPTION_JOB_NAME = 'transcribe-voice-note';
export const VOICE_CLEANUP_QUEUE_NAME = 'voice-notes-cleanup';

/** BullMQ backoff base delay between transcription retries (ms). */
export const VOICE_TRANSCRIPTION_BACKOFF_DELAY_MS = parseInt(
  process.env.VOICE_TRANSCRIPTION_BACKOFF_DELAY_MS ?? '5000',
  10,
);

/**
 * Default BullMQ job options for the transcription queue: bounded retries with exponential
 * backoff; keep failed jobs for dead-letter inspection so a lost job is observable.
 */
export const VOICE_TRANSCRIPTION_JOB_OPTIONS = {
  attempts: VOICE_TRANSCRIPTION_MAX_RETRIES,
  backoff: {
    type: 'exponential',
    delay: VOICE_TRANSCRIPTION_BACKOFF_DELAY_MS,
  },
  removeOnComplete: true,
  removeOnFail: false,
} as const;

/**
 * Fail-fast startup validation for voice-note configuration.
 *
 * Skipped under NODE_ENV=test (tests inject config directly), consistent with existing modules.
 * Throws with the full batch of invalid values so a misconfigured deployment never boots.
 */
export function validateVoiceNotesConfig(): void {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const errors: string[] = [];

  if (!MINIO_VOICE_NOTES_BUCKET.trim()) {
    errors.push('MINIO_VOICE_NOTES_BUCKET must be a non-empty string');
  }
  if (VOICE_ALLOWED_MIME_TYPES.length === 0) {
    errors.push('VOICE_ALLOWED_MIME_TYPES must list at least one audio MIME type');
  }
  if (VOICE_TRANSCRIPTION_ENABLED && !VOICE_AI_SERVICE_URL.trim()) {
    errors.push(
      'VOICE_AI_SERVICE_URL must be a non-empty string when VOICE_TRANSCRIPTION_ENABLED=true',
    );
  }

  const positiveInts: ReadonlyArray<readonly [string, number]> = [
    ['VOICE_MAX_DURATION_MS', VOICE_MAX_DURATION_MS],
    ['VOICE_MAX_SIZE_BYTES', VOICE_MAX_SIZE_BYTES],
    ['VOICE_UPLOAD_URL_TTL_SECONDS', VOICE_UPLOAD_URL_TTL_SECONDS],
    ['VOICE_PLAYBACK_URL_TTL_SECONDS', VOICE_PLAYBACK_URL_TTL_SECONDS],
    ['VOICE_UPLOAD_GRANT_TTL_SECONDS', VOICE_UPLOAD_GRANT_TTL_SECONDS],
    ['VOICE_TRANSCRIPTION_TIMEOUT_MS', VOICE_TRANSCRIPTION_TIMEOUT_MS],
    ['VOICE_TRANSCRIPTION_MAX_RETRIES', VOICE_TRANSCRIPTION_MAX_RETRIES],
    ['VOICE_CLEANUP_INTERVAL_MS', VOICE_CLEANUP_INTERVAL_MS],
    ['VOICE_CLEANUP_BATCH_SIZE', VOICE_CLEANUP_BATCH_SIZE],
    ['VOICE_TRANSCRIPTION_STUCK_THRESHOLD_MS', VOICE_TRANSCRIPTION_STUCK_THRESHOLD_MS],
    ['VOICE_ORPHAN_RECONCILE_GRACE_MS', VOICE_ORPHAN_RECONCILE_GRACE_MS],
    ['VOICE_TRANSCRIPTION_BACKOFF_DELAY_MS', VOICE_TRANSCRIPTION_BACKOFF_DELAY_MS],
  ];
  for (const [name, value] of positiveInts) {
    if (!Number.isInteger(value) || value <= 0) {
      errors.push(`${name} must be a positive integer, got ${value}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid voice-notes configuration:\n- ${errors.join('\n- ')}`);
  }
}
