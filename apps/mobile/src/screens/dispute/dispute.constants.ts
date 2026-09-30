/**
 * dispute.constants — Mobile config, endpoints, i18n keys, and design tokens for dispute-system
 * (Spec 21).
 *
 * Endpoints mirror the backend `disputes` controller. There is NO `POST /disputes`: the case is
 * created by service-completion's routing, never a direct client call. The resolution countdown
 * derives entirely from the server-returned durable deadline. Nothing security-sensitive is
 * hardcoded here; `EXPO_PUBLIC_DISPUTE_EVIDENCE_MAX_SIZE_BYTES` is a UX pre-check only.
 */

/** Backend REST endpoints for dispute-system. */
export const DISPUTE_ENDPOINTS = {
  dispute: (id: string): string => `/disputes/${id}`,
  requestUpload: (id: string): string => `/disputes/${id}/evidence/request-upload`,
  finalizeUpload: (id: string): string => `/disputes/${id}/evidence/finalize`,
  addEvidence: (id: string): string => `/disputes/${id}/evidence`,
  evidenceUrl: (id: string, evidenceId: string): string =>
    `/disputes/${id}/evidence/${evidenceId}/url`,
} as const;

/** Navigation route names for the dispute screens (mounted in both role stacks). */
export const DISPUTE_HOST_SCREEN_ROUTE = 'DisputeHost';
export const DISPUTE_CLEANER_SCREEN_ROUTE = 'DisputeCleaner';

/** UX-only max evidence size pre-check (the server is authoritative). */
export const DISPUTE_EVIDENCE_MAX_SIZE_BYTES = Number(
  process.env.EXPO_PUBLIC_DISPUTE_EVIDENCE_MAX_SIZE_BYTES ?? '10485760',
);

/** BidClean dark design tokens used by the dispute screens. */
export const DISPUTE_COLORS = {
  ACCENT: '#00F5D4',
  CARD: '#1F2833',
  BACKGROUND: '#0B0C10',
  TEXT: '#FFFFFF',
  TEXT_SECONDARY: '#C5C6C7',
  DANGER: '#FF6B6B',
} as const;

/** i18n keys for the dispute UI (en/es in parity). */
export const DISPUTE_I18N_KEYS = {
  HOST_TITLE: 'dispute.host.title',
  CLEANER_TITLE: 'dispute.cleaner.title',
  REASON_LABEL: 'dispute.host.reasonLabel',
  REASON_TEXT_PLACEHOLDER: 'dispute.host.reasonPlaceholder',
  ADD_PHOTO: 'dispute.host.addPhoto',
  ADD_NOTE: 'dispute.cleaner.addNote',
  SUBMIT_EVIDENCE: 'dispute.evidence.submit',
  COUNTDOWN_LABEL: 'dispute.countdown.label',
  COUNTDOWN_EXPIRED: 'dispute.countdown.expired',
  AUTO_RELEASE_PAUSED: 'dispute.cleaner.autoReleasePaused',
  STATE_OPEN: 'dispute.state.open',
  STATE_UNDER_REVIEW: 'dispute.state.underReview',
  STATE_RESOLVED: 'dispute.state.resolved',
  STATE_EXPIRED: 'dispute.state.expired',
  OUTCOME_FAVOR_CLEANER: 'dispute.outcome.favorCleaner',
  OUTCOME_FAVOR_HOST: 'dispute.outcome.favorHost',
  OUTCOME_PARTIAL: 'dispute.outcome.partial',
  EFFECT_RELEASED: 'dispute.effect.released',
  EFFECT_REFUNDED: 'dispute.effect.refunded',
  EFFECT_PARTIALLY_REFUNDED: 'dispute.effect.partiallyRefunded',
  EVIDENCE_TITLE: 'dispute.evidence.title',
  EVIDENCE_EMPTY: 'dispute.evidence.empty',
  LOAD_ERROR: 'dispute.loadError',
  ACTION_ERROR: 'dispute.actionError',
} as const;
