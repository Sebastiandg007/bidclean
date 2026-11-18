/**
 * dispute.types — Mobile domain types for dispute-system (Spec 21).
 *
 * Mirrors the backend `dispute-system` contracts (the dispute view + evidence refs). No internal
 * intent fields (attempt/lease/outcome/effective amount) are ever exposed. The resolution countdown
 * derives from the durable server deadline, never an authoritative client timer.
 */

/** Dispute lifecycle (server-authoritative). */
export type DisputeState = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'EXPIRED';

/** Phase derived from Spec 9's payment state (snapshotted at creation). */
export type DisputePhase = 'PRE_RELEASE' | 'POST_RELEASE';

/** Who initiated the dispute. */
export type DisputeInitiatorRole = 'HOST' | 'CLEANER';

/** The resolution outcome. */
export type DisputeResolution = 'FAVOR_CLEANER' | 'FAVOR_HOST' | 'PARTIAL';

/** Typed evidence kinds (visual kinds resolve to a URL; structured kinds to gated data). */
export type DisputeEvidenceKind =
  | 'HOST_PHOTO'
  | 'HOST_REASON'
  | 'CHECKLIST_REF'
  | 'CHECKLIST_PHOTO_REF'
  | 'VERIFICATION_REF'
  | 'ARRIVAL_REF'
  | 'NOTE';

/** WebSocket/best-effort connection status surfaced to the UI. */
export type ConnectionStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';

/** A single evidence reference (never a raw object key). */
export interface DisputeEvidence {
  readonly id: string;
  readonly kind: DisputeEvidenceKind;
  readonly submittedBy: string | null;
  readonly createdAt: string;
}

/** The client-facing dispute view (matches the backend `DisputeView`). */
export interface Dispute {
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
  readonly evidence: readonly DisputeEvidence[];
}

/** A minted pre-signed upload target for an evidence photo. */
export interface UploadTarget {
  readonly objectKey: string;
  readonly uploadUrl: string;
  readonly expiresAt: string;
}

/** A resolved evidence read (visual URL or structured gated data). */
export type ResolvedEvidence =
  | { readonly kind: 'visual'; readonly playbackUrl: string; readonly expiresAt: string }
  | { readonly kind: 'structured'; readonly data: Record<string, unknown> };
