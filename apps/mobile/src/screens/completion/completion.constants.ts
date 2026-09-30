/**
 * completion.constants — Mobile config, endpoints, i18n keys, and design tokens for
 * service-completion (Spec 20).
 *
 * Endpoints mirror the backend `service-completions` controller. There is NO client tunable for the
 * auto-release window — the countdown derives entirely from the server-returned durable deadline. No
 * secret and nothing security-sensitive is hardcoded here.
 */

/** Backend REST endpoints for service-completion. */
export const COMPLETION_ENDPOINTS = {
  completion: (id: string): string => `/service-completions/${id}`,
  confirm: (id: string): string => `/service-completions/${id}/confirm`,
  dispute: (id: string): string => `/service-completions/${id}/dispute`,
  postReleaseDispute: (id: string): string => `/service-completions/${id}/post-release-dispute`,
  ratings: (id: string): string => `/service-completions/${id}/ratings`,
} as const;

/** Navigation route names for the completion screens (mounted in both role stacks). */
export const COMPLETION_HOST_SCREEN_ROUTE = 'CompletionHost';
export const COMPLETION_CLEANER_SCREEN_ROUTE = 'CompletionCleaner';

/** Rating bounds (UX only — the server is authoritative). */
export const COMPLETION_RATING_MIN_STARS = 1;
export const COMPLETION_RATING_MAX_STARS = 5;

/** BidClean dark design tokens used by the completion screens. */
export const COMPLETION_COLORS = {
  ACCENT: '#00F5D4',
  CARD: '#1F2833',
  BACKGROUND: '#0B0C10',
  TEXT: '#FFFFFF',
  TEXT_SECONDARY: '#C5C6C7',
  DANGER: '#FF6B6B',
} as const;

/** i18n keys for the completion UI (en/es in parity). */
export const COMPLETION_I18N_KEYS = {
  HOST_TITLE: 'completion.host.title',
  CLEANER_TITLE: 'completion.cleaner.title',
  CONFIRM: 'completion.host.confirm',
  DISPUTE: 'completion.host.dispute',
  COUNTDOWN_LABEL: 'completion.host.countdownLabel',
  COUNTDOWN_EXPIRED: 'completion.host.countdownExpired',
  DISPUTE_PAUSED: 'completion.host.disputePaused',
  STATE_AWAITING: 'completion.state.awaiting',
  STATE_CONFIRMED: 'completion.state.confirmed',
  STATE_AUTO_RELEASED: 'completion.state.autoReleased',
  STATE_DISPUTED: 'completion.state.disputed',
  RELEASE_PENDING_PAYOUT: 'completion.release.pendingPayout',
  RELEASE_RELEASED: 'completion.release.released',
  RELEASE_NOT_TRIGGERED: 'completion.release.notTriggered',
  RELEASE_DISPUTED: 'completion.release.disputed',
  RATE_TITLE: 'completion.rating.title',
  RATE_PROMPT: 'completion.rating.prompt',
  RATE_COMMENT_PLACEHOLDER: 'completion.rating.commentPlaceholder',
  RATE_SUBMIT: 'completion.rating.submit',
  RATE_THANKS: 'completion.rating.thanks',
  LOAD_ERROR: 'completion.loadError',
  ACTION_ERROR: 'completion.actionError',
} as const;
