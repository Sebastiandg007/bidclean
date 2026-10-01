/**
 * verification.types — Mobile domain types for on-arrival video verification (Spec 18).
 *
 * Mirrors the backend `video-verification` client contract. The client NEVER sees the raw
 * `match_score` or the arrival footage — only the authoritative `state` and the derived
 * `classification`. The store/view therefore has no score or video-URL field (compile-time
 * enforcement of REQ-VV15).
 */

/** Verification lifecycle state (server-authoritative). */
export type VerificationState =
  | 'PENDING_UPLOAD'
  | 'UPLOADED'
  | 'PROCESSING'
  | 'MATCH'
  | 'NO_MATCH'
  | 'INCONCLUSIVE'
  | 'FAILED'
  | 'DISABLED'
  | 'EXPIRED';

/** The Host-facing derived classification (the only comparison surface exposed to a client). */
export type Classification = 'verified' | 'needs-review' | 'unavailable';

/** A UX-only display status derived for the local recorder/checking phases. */
export type DisplayStatus =
  | 'recording'
  | 'checking'
  | 'verified'
  | 'needs-review'
  | 'unavailable';

/**
 * The client-facing verification view (matches the backend `VerificationView`). Deliberately has
 * NO `matchScore` and NO video URL — the Host sees only the derived `classification`.
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

/** The upload target returned by request-upload (opaque key + short-lived pre-signed PUT). */
export interface UploadTarget {
  readonly objectKey: string;
  readonly uploadUrl: string;
  readonly expiresAt: string;
}

/** A recorded clip ready to upload (local file URI + advisory metadata). */
export interface RecordedClip {
  readonly uri: string;
  readonly durationMs: number;
  readonly mimeType: string;
  readonly sizeBytes: number;
}
