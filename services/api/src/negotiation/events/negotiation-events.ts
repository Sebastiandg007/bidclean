/**
 * Negotiation real-time event names and payload envelope.
 *
 * These events are published to Centrifugo channels for Hosts and Cleaners.
 * Every event carries a monotonic `version` (thread.version after the mutation)
 * and `sequenceNumber` so clients can discard out-of-order events, plus an
 * `eventId` (UUID) for client-side dedup, tracing, and log correlation.
 */

/** Negotiation event name constants */
export const NEGOTIATION_EVENT_NAMES = {
  PROPOSAL_CREATED: 'negotiation_proposal_created',
  PROPOSAL_COUNTERED: 'negotiation_proposal_countered',
  PROPOSAL_REJECTED: 'negotiation_proposal_rejected',
  PROPOSAL_ACCEPTED: 'negotiation_proposal_accepted',
} as const;

/** Union of valid negotiation event name strings */
export type NegotiationEventName =
  (typeof NEGOTIATION_EVENT_NAMES)[keyof typeof NEGOTIATION_EVENT_NAMES];

/**
 * Real-time negotiation event envelope.
 *
 * Cleaner identity summary is attached ONLY on the Host channel; it is never
 * leaked to Cleaners who did not win the offer.
 */
export interface NegotiationEvent {
  readonly eventId: string;
  readonly type: NegotiationEventName;
  readonly threadId: string;
  readonly proposalId: string;
  readonly offerId: string;
  readonly version: number;
  readonly sequenceNumber: number;
  readonly occurredAt: string;
}

/** The `offer_status_changed` event schema consumed by offer-radar */
export interface OfferStatusChangedEvent {
  readonly type: 'offer_status_changed';
  readonly offerId: string;
  readonly state: 'CANCELLED' | 'EXPIRED' | 'MATCHED';
  readonly changedAt: string;
}
