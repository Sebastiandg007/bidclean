import { KycStatus } from '../kyc.types';
import {
  NamedGuard,
  TransitionContext,
  TransitionMetadata,
} from './kyc-state-machine.types';
import { InvalidStateTransitionError } from './kyc-state-machine.errors';

/**
 * Valid KYC state transitions.
 * Maps each status to the set of statuses it can transition to.
 */
const VALID_TRANSITIONS: Record<KycStatus, readonly KycStatus[]> = {
  [KycStatus.NOT_STARTED]: [KycStatus.DOCUMENT_UPLOADED],
  [KycStatus.DOCUMENT_UPLOADED]: [KycStatus.SELFIE_UPLOADED],
  [KycStatus.SELFIE_UPLOADED]: [KycStatus.PROCESSING],
  [KycStatus.PROCESSING]: [KycStatus.VERIFIED, KycStatus.REJECTED],
  [KycStatus.VERIFIED]: [],
  [KycStatus.REJECTED]: [],
};

/**
 * Guards that must pass before a transition is allowed.
 * Each target status has zero or more precondition checks.
 */
const TRANSITION_GUARDS: Record<KycStatus, NamedGuard[]> = {
  [KycStatus.NOT_STARTED]: [],
  [KycStatus.DOCUMENT_UPLOADED]: [
    {
      name: 'documentStorageKeyRequired',
      check: (ctx: TransitionContext) =>
        ctx.documentStorageKey
          ? null
          : 'Document storage key must be provided',
    },
  ],
  [KycStatus.SELFIE_UPLOADED]: [
    {
      name: 'selfieStorageKeyRequired',
      check: (ctx: TransitionContext) =>
        ctx.selfieStorageKey
          ? null
          : 'Selfie storage key must be provided',
    },
    {
      name: 'documentMustExist',
      check: (ctx: TransitionContext) =>
        ctx.verification.documentStorageKey
          ? null
          : 'Document must be uploaded before selfie',
    },
  ],
  [KycStatus.PROCESSING]: [
    {
      name: 'selfieMustExist',
      check: (ctx: TransitionContext) =>
        ctx.verification.selfieStorageKey
          ? null
          : 'Selfie must be uploaded before processing',
    },
  ],
  [KycStatus.VERIFIED]: [],
  [KycStatus.REJECTED]: [
    {
      name: 'rejectionReasonRequired',
      check: (ctx: TransitionContext) =>
        ctx.rejectionReason
          ? null
          : 'Rejection reason must be provided',
    },
  ],
};

/**
 * KYC state machine.
 * Enforces valid state transitions, guards, and metadata for KYC verification flow.
 * Retries create a new attempt record rather than transitioning backwards.
 */
export class KycStateMachine {
  /**
   * Check if a state transition is valid.
   */
  static isValidTransition(from: KycStatus, to: KycStatus): boolean {
    const allowed = VALID_TRANSITIONS[from];
    return allowed.includes(to);
  }

  /**
   * Attempt to transition to a new status.
   * @throws InvalidStateTransitionError if the transition is not allowed
   */
  static transition(from: KycStatus, to: KycStatus): KycStatus {
    if (!KycStateMachine.isValidTransition(from, to)) {
      throw new InvalidStateTransitionError(from, to);
    }
    return to;
  }

  /**
   * Get all valid next states from the current status.
   */
  static getValidTransitions(from: KycStatus): readonly KycStatus[] {
    return VALID_TRANSITIONS[from];
  }

  /**
   * Check if a status is a terminal (final) state.
   */
  static isTerminal(status: KycStatus): boolean {
    return VALID_TRANSITIONS[status].length === 0;
  }

  /**
   * Get the guards that must pass for a given target status.
   */
  static getGuards(targetStatus: KycStatus): NamedGuard[] {
    return TRANSITION_GUARDS[targetStatus];
  }

  /**
   * Evaluate all guards for a transition.
   * Returns null if all guards pass, or the first failing guard info.
   */
  static evaluateGuards(
    targetStatus: KycStatus,
    context: TransitionContext,
  ): { guardName: string; reason: string } | null {
    const guards = TRANSITION_GUARDS[targetStatus];

    for (const guard of guards) {
      const error = guard.check(context);
      if (error !== null) {
        return { guardName: guard.name, reason: error };
      }
    }

    return null;
  }

  /**
   * Get the metadata fields that should be updated for a transition.
   * Records timestamps and contextual data for each state change.
   */
  static getTransitionMetadata(
    targetStatus: KycStatus,
    context: TransitionContext,
    now: Date,
  ): TransitionMetadata {
    switch (targetStatus) {
      case KycStatus.DOCUMENT_UPLOADED:
        return { documentUploadedAt: now };

      case KycStatus.SELFIE_UPLOADED:
        return { selfieUploadedAt: now };

      case KycStatus.PROCESSING:
        return { processingStartedAt: now };

      case KycStatus.VERIFIED:
        return {
          completedAt: now,
          reviewedBy: context.reviewedBy ?? null,
          reviewedAt: context.reviewedBy ? now : null,
        };

      case KycStatus.REJECTED:
        return {
          completedAt: now,
          rejectionReason: context.rejectionReason ?? null,
          reviewedBy: context.reviewedBy ?? null,
          reviewedAt: context.reviewedBy ? now : null,
        };

      default:
        return {};
    }
  }

  /**
   * Check if a transition attempt is idempotent.
   * Returns true if the entity is already in the target state.
   */
  static isIdempotent(currentStatus: KycStatus, targetStatus: KycStatus): boolean {
    return currentStatus === targetStatus;
  }
}
