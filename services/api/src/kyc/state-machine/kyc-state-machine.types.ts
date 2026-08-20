import { KycStatus } from '../kyc.types';
import { KycVerification } from '../entities/kyc-verification.entity';

/**
 * Context provided to transition guards for validation.
 * Contains the current verification entity and any additional data
 * needed to evaluate preconditions.
 */
export interface TransitionContext {
  /** The current verification entity being transitioned */
  readonly verification: KycVerification;
  /** Document storage key (required for DOCUMENT_UPLOADED transition) */
  readonly documentStorageKey?: string;
  /** Selfie storage key (required for SELFIE_UPLOADED transition) */
  readonly selfieStorageKey?: string;
  /** Rejection reason (required for REJECTED transition) */
  readonly rejectionReason?: string;
  /** ID of the admin reviewer (required for admin-driven transitions) */
  readonly reviewedBy?: string;
}

/**
 * Guard function signature.
 * Returns null if the guard passes, or an error message if it fails.
 */
export type TransitionGuard = (context: TransitionContext) => string | null;

/**
 * Named guard with a descriptive label for error reporting.
 */
export interface NamedGuard {
  readonly name: string;
  readonly check: TransitionGuard;
}

/**
 * Metadata fields updated per transition.
 * Maps each target status to the timestamp fields that should be set.
 */
export type TransitionMetadata = Partial<
  Pick<
    KycVerification,
    | 'documentUploadedAt'
    | 'selfieUploadedAt'
    | 'processingStartedAt'
    | 'completedAt'
    | 'rejectionReason'
    | 'reviewedBy'
    | 'reviewedAt'
  >
>;

/**
 * Result of a successful state transition.
 */
export interface TransitionResult {
  /** The verification ID */
  readonly verificationId: string;
  /** Previous status before transition */
  readonly previousStatus: KycStatus;
  /** New status after transition */
  readonly newStatus: KycStatus;
  /** Whether the transition was idempotent (already in target state) */
  readonly wasIdempotent: boolean;
  /** Timestamp of the transition */
  readonly transitionedAt: Date;
}

/**
 * Options for performing a state transition.
 */
export interface TransitionOptions {
  /** Target status to transition to */
  readonly targetStatus: KycStatus;
  /** Context for guard evaluation */
  readonly context: TransitionContext;
}
