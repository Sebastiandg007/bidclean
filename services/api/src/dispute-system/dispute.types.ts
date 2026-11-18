/**
 * dispute-system domain types, enums, view/summary shapes, and error strings (Spec 21).
 *
 * Internal contracts for the dispute CASE + resolution, the two durable intents (escrow-block +
 * financial), typed evidence references, and the derived views returned by `GET`. No payment
 * secrets/PII are embedded here or in any error string; the outbox payloads carry ids/enums/routing
 * fields only. VARCHAR + app validation everywhere (never PG enums).
 */

/** Dispute lifecycle states (single-winner transitions; RESOLVED/EXPIRED are terminal + immutable). */
export enum DisputeState {
  OPEN = 'OPEN',
  UNDER_REVIEW = 'UNDER_REVIEW',
  RESOLVED = 'RESOLVED',
  EXPIRED = 'EXPIRED',
}

/** Terminal dispute states (a terminal dispute always has a non-null resolution — data invariant). */
export const TERMINAL_DISPUTE_STATES: readonly DisputeState[] = [
  DisputeState.RESOLVED,
  DisputeState.EXPIRED,
];

/** The two active (non-terminal) states — the partial-unique active constraint covers these. */
export const ACTIVE_DISPUTE_STATES: readonly DisputeState[] = [
  DisputeState.OPEN,
  DisputeState.UNDER_REVIEW,
];

/**
 * Phase derived from Spec 9's ONE authoritative payment field (`payout_status`): POST_RELEASE iff
 * TRANSFER_CREATED/PAID, else PRE_RELEASE. Snapshotted at creation, never from the completion decision.
 */
export enum DisputePhase {
  PRE_RELEASE = 'PRE_RELEASE',
  POST_RELEASE = 'POST_RELEASE',
}

/** Who initiated the dispute. */
export enum DisputeInitiatorRole {
  HOST = 'HOST',
  CLEANER = 'CLEANER',
}

/** The resolver's decision, mapped by `resolution-mapping` to a financial action Spec 9 executes. */
export enum DisputeResolution {
  FAVOR_CLEANER = 'FAVOR_CLEANER',
  FAVOR_HOST = 'FAVOR_HOST',
  PARTIAL = 'PARTIAL',
}

/** Typed evidence kinds. Visual kinds resolve to a pre-signed URL; structured kinds to gated data. */
export enum DisputeEvidenceKind {
  HOST_PHOTO = 'HOST_PHOTO',
  HOST_REASON = 'HOST_REASON',
  CHECKLIST_REF = 'CHECKLIST_REF',
  CHECKLIST_PHOTO_REF = 'CHECKLIST_PHOTO_REF',
  VERIFICATION_REF = 'VERIFICATION_REF',
  ARRIVAL_REF = 'ARRIVAL_REF',
  NOTE = 'NOTE',
}

/** Visual kinds resolve to a short-lived pre-signed URL on read. */
export const VISUAL_EVIDENCE_KINDS: readonly DisputeEvidenceKind[] = [
  DisputeEvidenceKind.HOST_PHOTO,
  DisputeEvidenceKind.CHECKLIST_PHOTO_REF,
];

/** Whether a raw string is a valid evidence kind. */
export function isDisputeEvidenceKind(value: string): value is DisputeEvidenceKind {
  return (Object.values(DisputeEvidenceKind) as string[]).includes(value);
}

/** Whether an evidence kind resolves to a visual (URL) reference vs structured data. */
export function isVisualEvidenceKind(kind: DisputeEvidenceKind): boolean {
  return VISUAL_EVIDENCE_KINDS.includes(kind);
}

/** The escrow-block intent target (OPEN on creation, NONE on clear — clear-escrow-LAST). */
export enum EscrowIntentTarget {
  OPEN = 'OPEN',
  NONE = 'NONE',
}

/** The financial action chosen by the resolution (Spec 9 computes the exact amounts + ceilings). */
export enum FinancialIntentAction {
  RELEASE = 'RELEASE',
  FULL_REFUND = 'FULL_REFUND',
  PARTIAL_REFUND = 'PARTIAL_REFUND',
}

/**
 * The intent execution status. `ACTION_BLOCKED` is the durable needs-review terminal for a Spec 9
 * `BLOCKED` outcome (money NOT moved) — the escrow is never cleared on a blocked money effect.
 */
export enum IntentStatus {
  PENDING = 'PENDING',
  DISPATCHED = 'DISPATCHED',
  ACCEPTED = 'ACCEPTED',
  FAILED_RETRYABLE = 'FAILED_RETRYABLE',
  ACTION_BLOCKED = 'ACTION_BLOCKED',
}

/**
 * Spec 9's outcome surfaced back on a financial intent (dispute-system never overrides, only records).
 * APPLIED/CEILING_CLAMPED/NO_OP are "applied" terminals that trigger the clear-escrow-LAST step;
 * BLOCKED is "money NOT moved" (e.g. PAYMENT_ALREADY_SETTLED or a hard ceiling-block).
 */
export enum EscrowActionResult {
  APPLIED = 'APPLIED',
  CEILING_CLAMPED = 'CEILING_CLAMPED',
  NO_OP = 'NO_OP',
  BLOCKED = 'BLOCKED',
}

/** The applied terminals for which the escrow is cleared to NONE (clear-escrow-LAST). */
export const APPLIED_ESCROW_RESULTS: readonly EscrowActionResult[] = [
  EscrowActionResult.APPLIED,
  EscrowActionResult.CEILING_CLAMPED,
  EscrowActionResult.NO_OP,
];

/** Grant lifecycle for a single-use evidence upload grant (key != credential). */
export enum GrantStatus {
  ISSUED = 'ISSUED',
  CONSUMED = 'CONSUMED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

/** Object-deletion tombstone status. */
export enum ObjectDeletionStatus {
  PENDING = 'PENDING',
  DONE = 'DONE',
}

/** The event types emitted into `dispute_outbox`. */
export enum DisputeOutboxEventType {
  OPENED = 'dispute_opened',
  RESOLVED = 'dispute_resolved',
}

/** The outcome of a Spec 9 financial action, surfaced by the EscrowClient (never reimplemented here). */
export interface EscrowActionOutcome {
  readonly result: EscrowActionResult;
  /** The amount Spec 9 actually applied (may be clamped); authoritative final amount. */
  readonly effectiveAmountCents?: number;
  /** Spec 9's BLOCKED reason (e.g. PAYMENT_ALREADY_SETTLED); sanitized, for operator review. */
  readonly reason?: string;
}

/** The `service_disputed` routing payload (from Spec 20's completion_outbox). */
export interface ServiceDisputedPayload {
  readonly completionId: string;
  readonly offerId: string;
  readonly disputeId: string;
}

/** Map a raw `service_disputed` payload into the typed shape (defensive on missing fields). */
export function toServiceDisputedPayload(payload: Record<string, unknown>): ServiceDisputedPayload {
  return {
    completionId: String(payload.completionId ?? ''),
    offerId: String(payload.offerId ?? ''),
    disputeId: String(payload.disputeId ?? ''),
  };
}

/** A single evidence reference exposed to a participant/resolver (never a raw object key). */
export interface DisputeEvidenceView {
  readonly id: string;
  readonly kind: DisputeEvidenceKind;
  readonly submittedBy: string | null;
  readonly createdAt: string;
}

/**
 * The client-facing dispute view (reconciliation read). No internal intent fields are exposed
 * (no attempt/dispatched_at/lease_until/outcome/effective_amount_cents).
 */
export interface DisputeView {
  readonly id: string;
  readonly serviceCompletionId: string;
  readonly offerId: string;
  readonly state: DisputeState;
  readonly phase: DisputePhase;
  readonly initiatorRole: DisputeInitiatorRole;
  readonly reasonCode: string;
  readonly resolution: DisputeResolution | null;
  readonly resolutionRefundCents: number | null;
  readonly evidenceDeadline: string;
  readonly resolutionDeadline: string;
  readonly resolvedAt: string | null;
  readonly evidence: readonly DisputeEvidenceView[];
}

/**
 * dispute-system error messages.
 *
 * Non-sensitive, structural/authorization/lifecycle strings only. No payment secrets/PII.
 */
export const DISPUTE_ERROR_MESSAGES = {
  /** The referenced dispute does not exist (or the caller may not learn it does). */
  DISPUTE_NOT_FOUND: 'Dispute not found',
  /** The caller is neither a participant nor an authorized resolver. */
  NOT_AUTHORIZED: 'Not authorized for this dispute',
  /** The action requires an authorized resolver role. */
  NOT_A_RESOLVER: 'Only an authorized resolver may perform this action',
  /** The initiation policy denied this (role, reason_code, phase). */
  INITIATION_DENIED: 'This dispute initiation is not allowed',
  /** The dispute is terminal and cannot be transitioned again. */
  ALREADY_TERMINAL: 'The dispute is already resolved or expired',
  /** A resolve was attempted with an invalid resolution/amount combination. */
  INVALID_RESOLUTION: 'The resolution or amount is invalid',
  /** Evidence was submitted after the snapshotted evidence deadline. */
  EVIDENCE_WINDOW_CLOSED: 'The evidence submission window has closed',
  /** The referenced evidence does not belong to this dispute. */
  EVIDENCE_NOT_FOUND: 'Evidence not found for this dispute',
  /** The requested evidence kind is structured and has no downloadable URL. */
  EVIDENCE_NOT_VISUAL: 'This evidence has no downloadable URL',
  /** The upload grant is missing / wrong caller / wrong dispute. */
  GRANT_NOT_FOUND: 'Upload grant not found',
  /** The upload grant is expired or already consumed. */
  GRANT_UNUSABLE: 'Upload grant is expired or already used',
  /** The uploaded object is missing in storage. */
  OBJECT_MISSING: 'Uploaded object not found',
  /** The uploaded object exceeds the configured max size. */
  OBJECT_TOO_LARGE: 'Uploaded object exceeds the maximum size',
  /** The uploaded object is not an allowed image type. */
  OBJECT_INVALID_TYPE: 'Uploaded object is not an allowed image type',
  /** The uploaded object could not be probed as a valid image. */
  OBJECT_UNPROBEABLE: 'Uploaded object could not be validated as an image',
  /** The per-dispute evidence cap was reached. */
  EVIDENCE_CAP_REACHED: 'The evidence limit for this dispute has been reached',
  /** No escrow payment could be resolved for the offer bound to the completion. */
  PAYMENT_NOT_RESOLVED: 'No escrow payment resolved for this dispute',
  /** The authenticated Keycloak subject does not resolve to a BidClean user. */
  USER_NOT_FOUND: 'User not found',
} as const;
