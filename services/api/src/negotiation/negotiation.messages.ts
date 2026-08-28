/**
 * Negotiation error messages (server-side).
 *
 * Centralized so error strings are not scattered as literals across the service.
 * These are backend error messages; the mobile app maps HTTP outcomes to its own
 * i18n keys for user-facing text.
 */
export const NEGOTIATION_ERROR_MESSAGES = {
  OFFER_UNAVAILABLE: 'Offer is no longer available',
  OFFER_NOT_ACTIVE: 'Offer is not in ACTIVE state',
  NO_SENT_DELIVERY: 'This offer was not delivered to you',
  PRICE_OUT_OF_BOUNDS: 'Proposed price is outside the allowed range',
  MAX_PROPOSALS_REACHED: 'Maximum number of proposals reached for this negotiation',
  PROPOSAL_NOT_PENDING: 'Proposal is no longer pending',
  PROPOSAL_NOT_FOUND: 'Proposal not found',
  NOT_COUNTERPARTY: 'You are not authorized to act on this proposal',
  MISSING_IDEMPOTENCY_KEY: 'Idempotency-Key header is required',
} as const;
