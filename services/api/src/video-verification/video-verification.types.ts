/**
 * video-verification domain types + error strings (Spec 18).
 *
 * Internal contracts for the on-arrival identity check: the verification state machine, the
 * upload grant, server-authoritative object inspection, the derived comparison result, and the
 * Host-facing derived classification. Video bytes, frames, biometric embeddings, and the raw
 * `match_score` are treated as sensitive: none is ever embedded in an error message, log line, or
 * client-facing view — only structural/authorization/lifecycle facts appear here.
 */

/** Verification lifecycle states (VARCHAR + app validation, never a PG enum). */
export const VerificationState = {
  PENDING_UPLOAD: 'PENDING_UPLOAD',
  UPLOADED: 'UPLOADED',
  PROCESSING: 'PROCESSING',
  MATCH: 'MATCH',
  NO_MATCH: 'NO_MATCH',
  INCONCLUSIVE: 'INCONCLUSIVE',
  FAILED: 'FAILED',
  DISABLED: 'DISABLED',
  EXPIRED: 'EXPIRED',
} as const;
export type VerificationState = (typeof VerificationState)[keyof typeof VerificationState];

/** Terminal states — immutable audit facts once reached. */
export const TERMINAL_STATES: readonly VerificationState[] = [
  VerificationState.MATCH,
  VerificationState.NO_MATCH,
  VerificationState.INCONCLUSIVE,
  VerificationState.FAILED,
  VerificationState.DISABLED,
  VerificationState.EXPIRED,
];

/** Whether a state is terminal (immutable). */
export function isTerminalState(state: string): state is VerificationState {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

/** The derived comparison decision (advisory, never a hard gate). */
export const Decision = {
  MATCH: 'MATCH',
  NO_MATCH: 'NO_MATCH',
  INCONCLUSIVE: 'INCONCLUSIVE',
} as const;
export type Decision = (typeof Decision)[keyof typeof Decision];

/** Non-sensitive failure reasons (never a stack trace, never biometric data). */
export const FailureReason = {
  NO_REFERENCE: 'NO_REFERENCE',
  VIDEO_UNAVAILABLE: 'VIDEO_UNAVAILABLE',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  AI_TIMEOUT: 'AI_TIMEOUT',
  MAX_ATTEMPTS: 'MAX_ATTEMPTS',
} as const;
export type FailureReason = (typeof FailureReason)[keyof typeof FailureReason];

/** Which verified face was compared against. */
export const ReferenceSource = { KYC_SELFIE: 'KYC_SELFIE' } as const;
export type ReferenceSource = (typeof ReferenceSource)[keyof typeof ReferenceSource];

/** Grant lifecycle: ISSUED (usable) | CONSUMED (spent on a durable upload). */
export const GrantStatus = { ISSUED: 'ISSUED', CONSUMED: 'CONSUMED' } as const;
export type GrantStatus = (typeof GrantStatus)[keyof typeof GrantStatus];

/** Tombstone lifecycle: PENDING (awaiting MinIO removal) | DONE (object removed). */
export const ObjectDeletionStatus = { PENDING: 'PENDING', DONE: 'DONE' } as const;
export type ObjectDeletionStatus =
  (typeof ObjectDeletionStatus)[keyof typeof ObjectDeletionStatus];

/**
 * The Host-facing derived classification — the ONLY comparison surface exposed to a client.
 * The raw `match_score` and the raw footage are never included (REQ-VV15 / P13).
 */
export const Classification = {
  VERIFIED: 'verified',
  NEEDS_REVIEW: 'needs-review',
  UNAVAILABLE: 'unavailable',
} as const;
export type Classification = (typeof Classification)[keyof typeof Classification];

/** The outbox event types video-verification emits (fanned out to Spec 16). */
export const VerificationOutboxEventType = {
  COMPLETED: 'verification_completed',
  FLAGGED: 'verification_flagged',
} as const;
export type VerificationOutboxEventType =
  (typeof VerificationOutboxEventType)[keyof typeof VerificationOutboxEventType];

/** The physical outbox table owned by video-verification. */
export const VERIFICATION_OUTBOX_TABLE = 'verification_outbox';

/** The aggregate kind for video-verification outbox rows (app-validated short code). */
export const VERIFICATION_AGGREGATE_TYPE = 'verification_session';

/**
 * The durable arrival fact this module reacts to (drained from `service_outbox`). Ids only —
 * never PII. Mirrors the `service_arrived` payload emitted by service-tracking (Spec 17).
 */
export interface ArrivalPayload {
  readonly sessionId: string;
  readonly offerId: string;
  readonly cleanerId: string | null;
  readonly hostId: string | null;
  readonly arrivalDistanceM?: number;
}

/** Result of issuing an upload target: the opaque key + a short-lived pre-signed PUT URL. */
export interface UploadTarget {
  readonly objectKey: string;
  readonly uploadUrl: string;
  readonly expiresAt: string;
}

/**
 * Server-observed (authoritative) properties of a stored arrival-video object. `exists=false`
 * means the referenced object is missing; `durationMs=null` means it could not be probed as valid
 * video (an unprobeable object is treated as invalid).
 */
export interface InspectResult {
  readonly exists: boolean;
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly durationMs: number | null;
}

/**
 * The client-facing verification view (reconciliation read). Deliberately carries NO `match_score`
 * and NO video URL field — compile-time enforcement of REQ-VV15 / P13. The Host sees only the
 * derived `classification`.
 */
export interface VerificationView {
  readonly id: string;
  readonly serviceSessionId: string;
  readonly state: VerificationState;
  readonly classification: Classification;
  readonly createdAt: string;
  readonly uploadedAt: string | null;
  readonly processedAt: string | null;
}

/** The AI `/verify-face` typed result: similarity score + decision. */
export interface FaceVerifyResult {
  readonly score: number;
  readonly decision: Decision;
}

/**
 * Map a verification state to the single Host-facing derived classification. Total over every
 * state: MATCH ⇒ verified; NO_MATCH/INCONCLUSIVE ⇒ needs-review; everything else ⇒ unavailable.
 */
export function classify(state: VerificationState): Classification {
  if (state === VerificationState.MATCH) {
    return Classification.VERIFIED;
  }
  if (state === VerificationState.NO_MATCH || state === VerificationState.INCONCLUSIVE) {
    return Classification.NEEDS_REVIEW;
  }
  return Classification.UNAVAILABLE;
}

/**
 * video-verification error messages.
 *
 * Non-sensitive, structural/authorization/lifecycle strings only. Video bytes, frames, biometric
 * data, and the raw score are NEVER embedded here or in any thrown error, so no sensitive content
 * leaks into logs or responses.
 */
export const VERIFICATION_ERROR_MESSAGES = {
  /** The referenced verification does not exist (or the caller may not learn it does). */
  NOT_FOUND: 'Verification not found',
  /** The caller is not one of the session's two participants. */
  NOT_A_PARTICIPANT: 'Not a participant of this verification',
  /** The action requires the Cleaner role on the session. */
  NOT_THE_CLEANER: 'Only the arriving cleaner may perform this action',
  /** request-upload attempted while the verification is not PENDING_UPLOAD (DISABLED/terminal). */
  NOT_PENDING_UPLOAD: 'This verification is not awaiting an upload',
  /** No valid upload grant for the referenced key (missing/wrong user/wrong session). */
  GRANT_NOT_FOUND: 'No valid upload grant for this verification',
  /** The grant was already consumed or has expired. */
  GRANT_UNUSABLE: 'This upload grant is no longer usable',
  /** The referenced video object does not exist in storage. */
  OBJECT_MISSING: 'The uploaded video object was not found',
  /** The video object could not be validated as a permitted video type. */
  OBJECT_INVALID_TYPE: 'The uploaded object is not a permitted video type',
  /** The video object exceeds the configured maximum size. */
  OBJECT_TOO_LARGE: 'The uploaded video exceeds the maximum allowed size',
  /** The video duration exceeds the configured maximum (or was unprobeable). */
  DURATION_TOO_LONG: 'The video duration exceeds the maximum allowed length',
} as const;
