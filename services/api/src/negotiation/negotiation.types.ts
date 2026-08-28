/**
 * Negotiation domain types.
 *
 * Defines the generic Proposal model (actor = CLEANER | HOST), the proposal
 * state machine statuses, supersession reasons, thread status, and the internal
 * view/summary types returned by the service layer.
 */

/** Who authored a proposal within a negotiation thread */
export enum ProposalActor {
  CLEANER = 'CLEANER',
  HOST = 'HOST',
}

/** Proposal lifecycle status. Only PENDING is non-terminal. */
export enum ProposalStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  COUNTERED = 'COUNTERED',
  SUPERSEDED = 'SUPERSEDED',
  EXPIRED = 'EXPIRED',
}

/** Reason a PENDING proposal was superseded by an external event */
export enum SupersededReason {
  OFFER_MATCHED = 'OFFER_MATCHED',
  OFFER_CANCELLED = 'OFFER_CANCELLED',
  OFFER_EXPIRED = 'OFFER_EXPIRED',
  DIRECT_ACCEPT = 'DIRECT_ACCEPT',
}

/** Negotiation thread lifecycle status */
export enum ThreadStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

/** Named operations for idempotency scoping */
export enum NegotiationOperation {
  ACCEPT_OFFER = 'accept_offer',
  CREATE_COUNTEROFFER = 'create_counteroffer',
  ACCEPT_PROPOSAL = 'accept_proposal',
  REJECT_PROPOSAL = 'reject_proposal',
  COUNTER_PROPOSAL = 'counter_proposal',
}

/** Price breakdown for a proposal (all values in integer cents) */
export interface ProposalBreakdown {
  readonly proposedPriceCents: number;
  readonly cleanerPayoutCents: number;
  readonly hostTotalCents: number;
  readonly currency: string;
}

/** A single proposal as returned to clients */
export interface ProposalView {
  readonly id: string;
  readonly threadId: string;
  readonly offerId: string;
  readonly actor: ProposalActor;
  readonly sequenceNumber: number;
  readonly proposedPriceCents: number;
  readonly cleanerPayoutCents: number;
  readonly hostTotalCents: number;
  readonly currency: string;
  readonly status: ProposalStatus;
  readonly expiresAt: string;
  readonly createdAt: string;
}

/** A negotiation thread with its ordered proposals */
export interface ThreadView {
  readonly id: string;
  readonly offerId: string;
  readonly hostId: string;
  readonly cleanerId: string;
  readonly status: ThreadStatus;
  readonly basePriceCents: number;
  readonly currency: string;
  readonly version: number;
  readonly proposalCount: number;
  readonly proposals: ProposalView[];
}

/** Summary returned after a successful match */
export interface MatchSummary {
  readonly offerId: string;
  readonly cleanerId: string;
  readonly agreedPriceCents: number;
  readonly cleanerPayoutCents: number;
  readonly hostTotalCents: number;
  readonly currency: string;
  readonly matchedProposalId: string | null;
}

/** Cleaner summary attached to a Host inbox item (no private data) */
export interface CleanerSummary {
  readonly cleanerId: string;
  readonly fullName: string | null;
}

/** One entry in the Host counteroffer inbox */
export interface HostInboxItem {
  readonly offerId: string;
  readonly propertyName: string | null;
  readonly proposal: ProposalView;
  readonly cleaner: CleanerSummary;
  /** Immutable Base Price of the offer (for counter-back deviation bounds) */
  readonly basePriceCents: number;
  /** Offer's snapshotted commission rates (for an exact counter-back payout preview) */
  readonly hostFeeRateBps: number;
  readonly cleanerRateBps: number;
}

/** Raw row shape returned by the host inbox query */
export interface HostInboxRow {
  readonly proposal_id: string;
  readonly thread_id: string;
  readonly offer_id: string;
  readonly cleaner_id: string;
  readonly base_price_cents: number;
  readonly cleaner_full_name: string | null;
  readonly property_name_snapshot: string | null;
  readonly host_service_fee_rate_bps: number;
  readonly cleaner_commission_rate_bps: number;
  readonly actor: string;
  readonly sequence_number: number;
  readonly proposed_price_cents: number;
  readonly cleaner_payout_cents: number;
  readonly host_total_cents: number;
  readonly currency: string;
  readonly status: string;
  readonly expires_at: Date;
  readonly created_at: Date;
}
