/**
 * voice-notes domain types + error strings (Spec 14).
 *
 * Internal contracts for the voice-note send/upload/playback/transcription paths. Audio bytes and
 * transcript text are treated as untrusted user-derived content: neither is ever embedded in an
 * error message, log line, or metric — only structural/authorization failures are described here.
 */

import type { TranscriptStatus } from '../chat.types';

export type { TranscriptStatus } from '../chat.types';

/** Grant lifecycle: ISSUED (usable) | CONSUMED (spent on a durable message). */
export const GrantStatus = { ISSUED: 'ISSUED', CONSUMED: 'CONSUMED' } as const;
export type GrantStatus = (typeof GrantStatus)[keyof typeof GrantStatus];

/** Tombstone lifecycle: PENDING (awaiting MinIO removal) | DONE (object removed). */
export const ObjectDeletionStatus = { PENDING: 'PENDING', DONE: 'DONE' } as const;
export type ObjectDeletionStatus =
  (typeof ObjectDeletionStatus)[keyof typeof ObjectDeletionStatus];

/** Result of issuing an upload target: the opaque key + a short-lived pre-signed PUT URL. */
export interface UploadTarget {
  readonly objectKey: string;
  readonly uploadUrl: string;
  readonly expiresAt: string;
}

/** Result of a playback request: a short-lived pre-signed GET URL (raw key never exposed). */
export interface PlaybackTarget {
  readonly playbackUrl: string;
  readonly expiresAt: string;
}

/**
 * Server-observed (authoritative) properties of a stored audio object. `exists=false` means the
 * referenced object is missing; `durationMs=null` means it could not be probed as valid audio.
 */
export interface InspectResult {
  readonly exists: boolean;
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly durationMs: number | null;
}

/**
 * Immutable fields the client declares for a `VOICE` send. Duration/size/MIME are ADVISORY UX
 * pre-checks and the idempotency fingerprint; the server-observed object properties are
 * authoritative for the security-sensitive size/content-type/duration bounds.
 */
export interface SendVoiceParams {
  readonly conversationId: string;
  readonly senderId: string;
  readonly clientMessageId: string;
  readonly objectKey: string;
  readonly durationMs: number;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly waveform: number[] | null;
}

/**
 * The payload fingerprint used to detect an idempotency conflict for a `VOICE` send. Transcript
 * fields are derived and are deliberately excluded (REQ-VP5 / P7).
 */
export interface VoicePayloadFingerprint {
  readonly objectKey: string;
  readonly durationMs: number;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly waveform: number[] | null;
}

/** Build the payload fingerprint for a voice send from its declared metadata. */
export function buildVoiceFingerprint(
  params: Pick<
    SendVoiceParams,
    'objectKey' | 'durationMs' | 'sizeBytes' | 'mimeType' | 'waveform'
  >,
): VoicePayloadFingerprint {
  return {
    objectKey: params.objectKey,
    durationMs: params.durationMs,
    sizeBytes: params.sizeBytes,
    mimeType: params.mimeType,
    waveform: params.waveform,
  };
}

/**
 * Compare two fingerprints for idempotency equality. The waveform is compared by canonical JSON so
 * two equal arrays match and a changed array is a conflict (a null waveform equals a null waveform).
 */
export function fingerprintsEqual(
  a: VoicePayloadFingerprint,
  b: VoicePayloadFingerprint,
): boolean {
  return (
    a.objectKey === b.objectKey &&
    a.durationMs === b.durationMs &&
    a.sizeBytes === b.sizeBytes &&
    a.mimeType === b.mimeType &&
    JSON.stringify(a.waveform ?? null) === JSON.stringify(b.waveform ?? null)
  );
}

/** Params for attaching a transcript result, guarded by the latest-attempt rule. */
export interface AttachTranscriptParams {
  readonly messageId: string;
  readonly attempt: number;
  readonly transcript: string | null;
  readonly lang: string | null;
  readonly status: TranscriptStatus;
}

/** Result the AI Whisper endpoint returns for a transcription request. */
export interface TranscriptionResult {
  readonly text: string;
  readonly language: string | null;
}

/**
 * voice-note error messages.
 *
 * Non-sensitive, structural/authorization strings only. Audio bytes and transcript text are NEVER
 * embedded here or in any thrown error, so no user-derived content leaks into logs or responses.
 */
export const VOICE_ERROR_MESSAGES = {
  /** No valid upload grant for the referenced key (missing/wrong user/wrong conversation). */
  GRANT_NOT_FOUND: 'No valid upload grant for this voice note',
  /** The grant was already consumed or has expired. */
  GRANT_UNUSABLE: 'This upload grant is no longer usable',
  /** The referenced audio object does not exist in storage. */
  OBJECT_MISSING: 'The uploaded audio object was not found',
  /** The audio object could not be validated as a permitted audio type. */
  OBJECT_INVALID_TYPE: 'The uploaded object is not a permitted audio type',
  /** The audio object exceeds the configured maximum size. */
  OBJECT_TOO_LARGE: 'The uploaded audio exceeds the maximum allowed size',
  /** The audio duration exceeds the configured maximum. */
  DURATION_TOO_LONG: 'The audio duration exceeds the maximum allowed length',
  /** Same clientMessageId reused with a different voice payload fingerprint. */
  FINGERPRINT_CONFLICT:
    'clientMessageId was already used with a different voice note',
  /** The referenced message is not a voice note (playback requested for a non-voice message). */
  NOT_A_VOICE_NOTE: 'This message is not a voice note',
} as const;
