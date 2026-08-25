import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OfferState } from '../offers.types';
import { ALLOWED_TRANSITIONS } from '../offers.constants';
import { Offer } from '../entities/offer.entity';
import { OfferStateTransition } from '../entities/offer-state-transition.entity';

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

/**
 * Offer state machine service.
 *
 * Executes state transitions with optimistic locking (UPDATE WHERE state = expectedState)
 * and inserts an audit trail record on every successful transition.
 * Returns a boolean indicating success or race-condition loss.
 */
@Injectable()
export class OfferStateMachineService {
  constructor(
    @InjectRepository(Offer)
    private readonly offerRepo: Repository<Offer>,
    @InjectRepository(OfferStateTransition)
    private readonly transitionRepo: Repository<OfferStateTransition>,
  ) {}

  /**
   * Execute a state transition with optimistic locking.
   *
   * @param offerId - The offer to transition
   * @param expectedState - The state we expect the offer to be in (guard against races)
   * @param newState - The target state
   * @param triggeredBy - Who/what triggered this (e.g., 'host', 'system', 'scheduler')
   * @param metadata - Optional context (e.g., cancellation reason, matched cleaner ID)
   * @returns true if transition succeeded, false if invalid or lost race
   */
  async transitionState(
    offerId: string,
    expectedState: OfferState,
    newState: OfferState,
    triggeredBy: string,
    metadata?: Record<string, unknown>,
  ): Promise<boolean> {
    const validation = validateTransition(expectedState, newState);
    if (!validation.valid) {
      return false;
    }

    const result = await this.offerRepo
      .createQueryBuilder()
      .update(Offer)
      .set({ state: newState, updatedAt: () => 'NOW()' })
      .where('id = :offerId AND state = :expectedState', { offerId, expectedState })
      .execute();

    if (result.affected === 0) {
      return false;
    }

    await this.transitionRepo.save({
      offerId,
      fromState: expectedState,
      toState: newState,
      triggeredBy,
      metadata: metadata ?? null,
    });

    return true;
  }
}
