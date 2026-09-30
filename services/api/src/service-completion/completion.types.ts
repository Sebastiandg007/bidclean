/**
 * service-completion domain types + error strings (Spec 20).
 *
 * Internal contracts for the completion DECISION, the durable release intent, ratings, and the
 * derived views returned by `GET`. No payment secrets/PII are embedded here or in any error string;
 * the outbox payloads carry ids/enums/routing fields only.
 */

/** Completion lifecycle states (VARCHAR + app validation, never a PG enum). PRE-release only. */
export const CompletionState = {
  AWAITING_CONFIRMATION: 'AWAITING_CONFIRMATION',
  CONFIRMED: 'CONFIRMED',
  AUTO_RELEASED: 'AUTO_RELEASED',
  DISPUTED: 'DISPUTED',
} as const;
export type CompletionState = (typeof CompletionState)[keyof typeof CompletionState];

/** The two release-bearing terminal states (each carries a `released_trigger` + an intent). */
export const RELEASED_STATES: readonly CompletionState[] = [
  CompletionState.CONFIRMED,
  CompletionState.AUTO_RELEASED,
];

/** Whether a raw string is a valid completion state. */
export function isCompletionState(value: string): value is CompletionState {
  return (Object.values(CompletionState) as string[]).includes(value);
}

/**
 * The release reason carried on the intent and passed to Spec 9's `EscrowReleaseService.release`.
 * A subset of Spec 9's `ReleaseReason` (service-completion only ever chooses these two).
 */
export const CompletionReleaseReason = {
  HOST_CONFIRMED: 'HOST_CONFIRMED',
  AUTO_RELEASE: 'AUTO_RELEASE',
} as const;
export type CompletionReleaseReason =
  (typeof CompletionReleaseReason)[keyof typeof CompletionReleaseReason];

/** The release-intent execution status (distinct from the completion DECISION state). */
export const IntentStatus = {
  PENDING: 'PENDING',
  DISPATCHED: 'DISPATCHED',
  ACCEPTED: 'ACCEPTED',
  FAILED_RETRYABLE: 'FAILED_RETRYABLE',
} as const;
export type IntentStatus = (typeof IntentStatus)[keyof typeof IntentStatus];

/** Rating side (which participant rated the other). */
export const RatingRole = {
  HOST_RATES_CLEANER: 'HOST_RATES_CLEANER',
  CLEANER_RATES_HOST: 'CLEANER_RATES_HOST',
} as const;
export type RatingRole = (typeof RatingRole)[keyof typeof RatingRole];

/**
 * The server-derived release-execution status returned by `GET` — never the internal intent fields
 * (attempt/dispatched_at/lease_until/last_error). This is what the Cleaner UI uses to distinguish
 * released / pending-payout and what `openPostReleaseDispute` gates on.
 */
export const ReleaseStatus = {
  /** No intent exists yet (AWAITING_CONFIRMATION or DISPUTED — no release-bearing decision). */
  NOT_TRIGGERED: 'NOT_TRIGGERED',
  /** An intent exists but is not yet ACCEPTED (covers PENDING/DISPATCHED/FAILED_RETRYABLE). */
  PENDING: 'PENDING',
  /** The intent is ACCEPTED (Spec 9 durably accepted the release command; payout may still settle). */
  ACCEPTED: 'ACCEPTED',
} as const;
export type ReleaseStatus = (typeof ReleaseStatus)[keyof typeof ReleaseStatus];

/** The event types emitted into `completion_outbox`. */
export const CompletionOutboxEventType = {
  CONFIRMED: 'service_confirmed',
  DISPUTED: 'service_disputed',
  RATED: 'service_rated',
} as const;
export type CompletionOutboxEventType =
  (typeof CompletionOutboxEventType)[keyof typeof CompletionOutboxEventType];

/**
 * The event-carried checklist-completed payload the creation consumer reads. `completedAt` is the
 * run's AUTHORITATIVE finish time (Spec 19 additive extension); the deadline is anchored to it,
 * never to the consume time.
 */
export interface ChecklistCompletedPayload {
  readonly runId: string;
  readonly serviceSessionId: string;
  readonly totalTasks: number;
  readonly completedTasks: number;
  readonly photoCount: number;
  readonly completedAt: string;
}

/** Rating status summary surfaced on the completion view (whether each side has rated). */
export interface RatingStatusView {
  readonly hostRated: boolean;
  readonly cleanerRated: boolean;
}

/** The client-facing completion view (reconciliation read). No internal intent fields. */
export interface ServiceCompletionView {
  readonly id: string;
  readonly serviceSessionId: string;
  readonly offerId: string;
  readonly state: CompletionState;
  readonly autoReleaseDeadline: string;
  readonly confirmedAt: string | null;
  readonly releasedTrigger: CompletionReleaseReason | null;
  readonly disputeId: string | null;
  readonly postReleaseDisputeId: string | null;
  readonly releaseStatus: ReleaseStatus;
  readonly ratingStatus: RatingStatusView;
}

/** A single rating exposed to a participant (never the ids of the other party beyond the role). */
export interface ServiceRatingView {
  readonly role: RatingRole;
  readonly stars: number;
  readonly comment: string | null;
  readonly createdAt: string;
}

/**
 * service-completion error messages.
 *
 * Non-sensitive, structural/authorization/lifecycle strings only. No payment secrets/PII.
 */
export const COMPLETION_ERROR_MESSAGES = {
  /** The referenced completion does not exist (or the caller may not learn it does). */
  COMPLETION_NOT_FOUND: 'Service completion not found',
  /** The caller is not one of the completion's two participants. */
  NOT_A_PARTICIPANT: 'Not a participant of this service completion',
  /** The action requires the Host role on the completion. */
  NOT_THE_HOST: 'Only the host may perform this action',
  /** The transition is not allowed from the completion's current state. */
  INVALID_STATE: 'The service completion is not in a state that allows this action',
  /** A post-release dispute was attempted before the release was actually executed (ACCEPTED). */
  RELEASE_NOT_YET_EXECUTED: 'Release not yet executed',
  /** The rating side is already taken for this completion. */
  RATING_DUPLICATE: 'A rating for this side already exists',
  /** The submitted stars are outside the configured bounds. */
  RATING_OUT_OF_RANGE: 'The rating stars are out of the allowed range',
  /** A checklist_completed event without the authoritative finish time (pre-extension). */
  MISSING_COMPLETED_AT: 'checklist_completed is missing the authoritative finish time',
  /** No escrow payment could be resolved for the offer bound to the session. */
  PAYMENT_NOT_RESOLVED: 'No escrow payment resolved for this offer',
  /** The authenticated Keycloak subject does not resolve to a BidClean user. */
  USER_NOT_FOUND: 'User not found',
} as const;
