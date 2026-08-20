import { KycStatus } from '../kyc.types';

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
 * KYC state machine.
 * Enforces valid state transitions for KYC verification flow.
 * Retries create a new attempt record rather than transitioning backwards.
 */
export class KycStateMachine {
  /**
   * Check if a state transition is valid.
   * @param from - Current status
   * @param to - Target status
   * @returns true if the transition is allowed
   */
  static isValidTransition(from: KycStatus, to: KycStatus): boolean {
    const allowed = VALID_TRANSITIONS[from];
    return allowed.includes(to);
  }

  /**
   * Attempt to transition to a new status.
   * @param from - Current status
   * @param to - Target status
   * @throws Error if the transition is invalid
   * @returns The new status
   */
  static transition(from: KycStatus, to: KycStatus): KycStatus {
    if (!KycStateMachine.isValidTransition(from, to)) {
      throw new Error(
        `Invalid KYC state transition: ${from} → ${to}`,
      );
    }
    return to;
  }

  /**
   * Get all valid next states from the current status.
   * @param from - Current status
   * @returns Array of valid target statuses
   */
  static getValidTransitions(from: KycStatus): readonly KycStatus[] {
    return VALID_TRANSITIONS[from];
  }

  /**
   * Check if a status is a terminal (final) state.
   * @param status - Status to check
   * @returns true if VERIFIED or REJECTED
   */
  static isTerminal(status: KycStatus): boolean {
    return VALID_TRANSITIONS[status].length === 0;
  }
}
