import { OfferState } from '../offers.types';
import { ALLOWED_TRANSITIONS } from '../offers.constants';

/**
 * Offer state machine.
 *
 * Pure function that validates and executes state transitions.
 * Uses optimistic locking at the database level:
 * UPDATE offers SET state = :newState WHERE id = :id AND state = :expectedState
 *
 * If affectedRows = 0, the transition lost a race (concurrent modification).
 * The caller must handle the conflict.
 */

/** Result of a state transition attempt */
export interface TransitionResult {
  /** Whether the transition was valid and should be executed */
  readonly valid: boolean;
  /** Error message if transition is invalid */
  readonly reason?: string;
}

/**
 * Validate if a state transition is allowed.
 *
 * @param currentState - Current offer state
 * @param targetState - Desired new state
 * @returns TransitionResult indicating validity
 */
export function validateTransition(
  currentState: OfferState,
  targetState: OfferState,
): TransitionResult {
  const allowed = ALLOWED_TRANSITIONS[currentState] ?? [];

  if (!allowed.includes(targetState)) {
    return {
      valid: false,
      reason: `Transition from ${currentState} to ${targetState} is not allowed`,
    };
  }

  return { valid: true };
}
