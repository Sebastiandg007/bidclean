/**
 * completion.types — Mobile domain types for service-completion (Spec 20).
 *
 * Mirrors the backend `service-completion` contracts (the completion view + ratings). No internal
 * intent fields (attempt/dispatched_at/lease_until/last_error) are ever exposed — the Cleaner UI
 * uses the server-derived `releaseStatus` only. The auto-release countdown derives from the durable
 * server deadline, never an authoritative client timer.
 */

/** Pre-release completion lifecycle (server-authoritative). */
export type CompletionState = 'AWAITING_CONFIRMATION' | 'CONFIRMED' | 'AUTO_RELEASED' | 'DISPUTED';

/** The release trigger recorded on a released completion. */
export type ReleasedTrigger = 'HOST_CONFIRMED' | 'AUTO_RELEASE';

/** The server-derived release-execution status (no internal intent fields). */
export type ReleaseStatus = 'NOT_TRIGGERED' | 'PENDING' | 'ACCEPTED';

/** Rating side (which participant rated the other). */
export type RatingRole = 'HOST_RATES_CLEANER' | 'CLEANER_RATES_HOST';

/** WebSocket/best-effort connection status surfaced to the UI. */
export type ConnectionStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';

/** Whether each side has rated (from the completion view). */
export interface RatingStatus {
  readonly hostRated: boolean;
  readonly cleanerRated: boolean;
}

/** The client-facing completion view (matches the backend `ServiceCompletionView`). */
export interface ServiceCompletion {
  readonly id: string;
  readonly serviceSessionId: string;
  readonly offerId: string;
  readonly state: CompletionState;
  readonly autoReleaseDeadline: string;
  readonly confirmedAt: string | null;
  readonly releasedTrigger: ReleasedTrigger | null;
  readonly disputeId: string | null;
  readonly postReleaseDisputeId: string | null;
  readonly releaseStatus: ReleaseStatus;
  readonly ratingStatus: RatingStatus;
}

/** A single rating (as returned by the ratings read). */
export interface ServiceRating {
  readonly role: RatingRole;
  readonly stars: number;
  readonly comment: string | null;
  readonly createdAt: string;
}
