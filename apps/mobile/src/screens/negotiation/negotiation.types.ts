/**
 * Negotiation types — mobile-side interfaces for the offer negotiation flow.
 *
 * Mirrors the backend proposal/thread model. Prices are integer cents; the UI
 * formats them per locale + offer currency.
 */

/** Who authored a proposal */
export type ProposalActor = 'CLEANER' | 'HOST';

/** Proposal lifecycle status (only PENDING is non-terminal) */
export type ProposalStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'COUNTERED'
  | 'SUPERSEDED'
  | 'EXPIRED';

/** A single proposal within a negotiation thread */
export interface ProposalView {
  id: string;
  threadId: string;
  offerId: string;
  actor: ProposalActor;
  sequenceNumber: number;
  proposedPriceCents: number;
  cleanerPayoutCents: number;
  hostTotalCents: number;
  currency: string;
  status: ProposalStatus;
  expiresAt: string;
  createdAt: string;
}

/** A negotiation thread with its ordered proposals */
export interface ThreadView {
  id: string;
  offerId: string;
  hostId: string;
  cleanerId: string;
  status: 'OPEN' | 'CLOSED';
  basePriceCents: number;
  currency: string;
  version: number;
  proposalCount: number;
  proposals: ProposalView[];
}

/** Summary returned after a successful match */
export interface MatchSummary {
  offerId: string;
  cleanerId: string;
  agreedPriceCents: number;
  cleanerPayoutCents: number;
  hostTotalCents: number;
  currency: string;
  matchedProposalId: string | null;
}

/** Result of an accept action (direct accept or counter-back accept) */
export interface AcceptResult {
  success: boolean;
  /** i18n error key when success is false */
  errorKey?: string;
  match?: MatchSummary;
}

/** Cleaner summary shown to the Host (no private data) */
export interface CleanerSummary {
  cleanerId: string;
  fullName: string | null;
}

/** One entry in the Host counteroffer inbox */
export interface HostInboxItem {
  offerId: string;
  propertyName: string | null;
  proposal: ProposalView;
  cleaner: CleanerSummary;
}

/** Price breakdown preview shown while entering a price */
export interface Breakdown {
  proposedPriceCents: number;
  cleanerPayoutCents: number;
  hostTotalCents: number;
  currency: string;
}

/** Real-time negotiation event names */
export type NegotiationEventName =
  | 'negotiation_proposal_created'
  | 'negotiation_proposal_countered'
  | 'negotiation_proposal_rejected'
  | 'negotiation_proposal_accepted';

/** Real-time negotiation event envelope (version/sequence-gated) */
export interface NegotiationEvent {
  eventId: string;
  type: NegotiationEventName;
  threadId: string;
  proposalId: string;
  offerId: string;
  version: number;
  sequenceNumber: number;
  occurredAt: string;
}
