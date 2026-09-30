/**
 * verification.constants — Mobile config, endpoints, and i18n keys for on-arrival video verification.
 *
 * Endpoints mirror the backend `video-verifications` controller. Tunables come from `EXPO_PUBLIC_*`
 * with sensible fallbacks (no magic numbers in logic). The only client config is a UX max-duration
 * pre-check — everything security-sensitive is server-authoritative. There is DELIBERATELY no
 * playback endpoint (the client never fetches the footage).
 */

import type { Classification, DisplayStatus, VerificationState } from './verification.types';

/** Backend REST endpoints for video verification. */
export const VERIFICATION_ENDPOINTS = {
  get: (id: string): string => `/video-verifications/${id}`,
  requestUpload: (id: string): string => `/video-verifications/${id}/request-upload`,
  finalize: (id: string): string => `/video-verifications/${id}/finalize`,
} as const;

/** Client-side max-duration pre-check (UX only; the server is authoritative). */
export const VERIFICATION_MAX_DURATION_MS = parseInt(
  process.env.EXPO_PUBLIC_VIDEO_VERIFICATION_MAX_DURATION_MS ?? '15000',
  10,
);

/** Navigation route names for the verification screens. */
export const ARRIVAL_VERIFICATION_SCREEN_ROUTE = 'ArrivalVerification';

/** BidClean dark design tokens used by the verification screens. */
export const VERIFICATION_COLORS = {
  ACCENT: '#00F5D4',
  CARD: '#1F2833',
  BACKGROUND: '#0B0C10',
  TEXT: '#FFFFFF',
} as const;

/** Map a server verification state to the Host-facing derived classification (mirrors backend). */
export function classify(state: VerificationState): Classification {
  if (state === 'MATCH') {
    return 'verified';
  }
  if (state === 'NO_MATCH' || state === 'INCONCLUSIVE') {
    return 'needs-review';
  }
  return 'unavailable';
}

/** Map a server state to the UX display status (checking while pre-terminal comparison runs). */
export function toDisplayStatus(state: VerificationState): DisplayStatus {
  if (state === 'UPLOADED' || state === 'PROCESSING') {
    return 'checking';
  }
  return classify(state);
}

/** i18n keys for the verification UI (en/es in parity). */
export const VERIFICATION_I18N_KEYS = {
  CLEANER_TITLE: 'verification.cleaner.title',
  CLEANER_INSTRUCTION: 'verification.cleaner.instruction',
  RECORD: 'verification.cleaner.record',
  STOP: 'verification.cleaner.stop',
  UPLOADING: 'verification.cleaner.uploading',
  RECORDED: 'verification.cleaner.recorded',
  SKIP_HINT: 'verification.cleaner.skipHint',
  PERMISSION_DENIED: 'verification.cleaner.permissionDenied',
  PERMISSION_EXPLAINER: 'verification.cleaner.permissionExplainer',
  HOST_TITLE: 'verification.host.title',
  STATUS_RECORDING: 'verification.status.recording',
  STATUS_CHECKING: 'verification.status.checking',
  STATUS_VERIFIED: 'verification.status.verified',
  STATUS_NEEDS_REVIEW: 'verification.status.needsReview',
  STATUS_UNAVAILABLE: 'verification.status.unavailable',
  NEEDS_REVIEW_HINT: 'verification.host.needsReviewHint',
  DISPUTE_PATH: 'verification.host.disputePath',
  LOAD_ERROR: 'verification.loadError',
} as const;
