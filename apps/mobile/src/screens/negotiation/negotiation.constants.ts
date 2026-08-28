/**
 * Negotiation screen constants.
 *
 * Route names, endpoint builders, i18n error keys, and the deviation-bounds
 * mirror (the backend is authoritative; these are used only for client-side
 * pre-validation and payout preview).
 */

const BPS_DIVISOR = 10000;

/** Navigation route names for the negotiation stack */
export const NEGOTIATION_ROUTES = {
  CleanerNegotiation: 'CleanerNegotiation',
  HostCounterofferInbox: 'HostCounterofferInbox',
} as const;

/** REST endpoint builders */
export const NEGOTIATION_ENDPOINTS = {
  ACCEPT_OFFER: (offerId: string) => `/negotiation/offers/${offerId}/accept`,
  COUNTEROFFERS: (offerId: string) => `/negotiation/offers/${offerId}/counteroffers`,
  ACCEPT_PROPOSAL: (proposalId: string) => `/negotiation/proposals/${proposalId}/accept`,
  REJECT_PROPOSAL: (proposalId: string) => `/negotiation/proposals/${proposalId}/reject`,
  COUNTER_PROPOSAL: (proposalId: string) => `/negotiation/proposals/${proposalId}/counter`,
  THREAD: (offerId: string) => `/negotiation/offers/${offerId}/thread`,
  HOST_INBOX: '/negotiation/host/counteroffers',
} as const;

/** Header carrying the client-generated idempotency key */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/** i18n error keys for negotiation operations */
export const NEGOTIATION_ERROR_KEYS = {
  ACCEPT: 'negotiation.error.accept_failed',
  COUNTEROFFER: 'negotiation.error.counteroffer_failed',
  REJECT: 'negotiation.error.reject_failed',
  COUNTER: 'negotiation.error.counter_failed',
  FETCH_THREAD: 'negotiation.error.fetch_thread_failed',
  FETCH_INBOX: 'negotiation.error.fetch_inbox_failed',
  OFFER_UNAVAILABLE: 'negotiation.error.offer_unavailable',
  OUT_OF_BOUNDS: 'negotiation.error.price_out_of_bounds',
} as const;

/**
 * Deviation bounds mirror (must match backend NEGOTIATION_MIN/MAX_DEVIATION_BPS).
 * Configurable via Expo public env; the server remains authoritative.
 */
export const NEGOTIATION_MIN_DEVIATION_BPS = Number(
  process.env.EXPO_PUBLIC_NEGOTIATION_MIN_DEVIATION_BPS ?? '2000',
);

export const NEGOTIATION_MAX_DEVIATION_BPS = Number(
  process.env.EXPO_PUBLIC_NEGOTIATION_MAX_DEVIATION_BPS ?? '2000',
);

/** Inclusive allowed price range relative to the immutable Base Price */
export function getDeviationRange(basePriceCents: number): {
  minPriceCents: number;
  maxPriceCents: number;
} {
  const minDelta = Math.trunc((basePriceCents * NEGOTIATION_MIN_DEVIATION_BPS) / BPS_DIVISOR);
  const maxDelta = Math.trunc((basePriceCents * NEGOTIATION_MAX_DEVIATION_BPS) / BPS_DIVISOR);
  return {
    minPriceCents: basePriceCents - minDelta,
    maxPriceCents: basePriceCents + maxDelta,
  };
}

/** Whether a proposed price is within the allowed deviation bounds of the Base Price */
export function isWithinDeviationBounds(basePriceCents: number, proposedPriceCents: number): boolean {
  const { minPriceCents, maxPriceCents } = getDeviationRange(basePriceCents);
  return proposedPriceCents >= minPriceCents && proposedPriceCents <= maxPriceCents;
}
