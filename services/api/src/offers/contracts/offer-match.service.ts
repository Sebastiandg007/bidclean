import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OfferMatchInterface, MatchResult, MatchSource } from './offer-match.interface';
import { OfferStateMachineService } from '../state-machine/offer-state-machine';
import { Offer } from '../entities/offer.entity';
import { OfferState } from '../offers.types';

/**
 * Concrete implementation of the OfferMatchContract.
 *
 * Exposed to external modules (offer-negotiation, offer-radar) to execute
 * the ACTIVE → MATCHED state transition when a Cleaner accepts an offer.
 * Only this service can trigger the match transition — external modules
 * MUST NOT write to the offers table directly.
 *
 * Uses optimistic locking via the state machine to handle concurrent match attempts.
 */
@Injectable()
export class OfferMatchService implements OfferMatchInterface {
  private readonly logger = new Logger(OfferMatchService.name);

  constructor(
    @InjectRepository(Offer)
    private readonly offerRepo: Repository<Offer>,
    private readonly stateMachine: OfferStateMachineService,
  ) {}

  /**
   * Match a Cleaner to an offer (ACTIVE → MATCHED).
   *
   * Validates the offer exists and is in ACTIVE state, then delegates
   * the state transition to the state machine with optimistic locking.
   * On success, sets the `matched_at` timestamp.
   *
   * @param offerId - The offer UUID to match
   * @param cleanerId - The Cleaner user UUID accepting the offer
   * @param matchSource - What triggered the match (direct_accept, negotiation, auto_assign)
   * @returns Match result indicating success or failure with reason
   */
  async match(
    offerId: string,
    cleanerId: string,
    matchSource: MatchSource,
  ): Promise<MatchResult> {
    const offer = await this.offerRepo.findOne({ where: { id: offerId } });

    if (!offer) {
      this.logger.warn(`Match attempt on non-existent offer: ${offerId}`);
      return { success: false, reason: 'Offer not found' };
    }

    if (offer.state !== OfferState.ACTIVE) {
      this.logger.warn(
        `Match attempt on offer ${offerId} in invalid state: ${offer.state}`,
      );
      return {
        success: false,
        reason: `Offer is not in ACTIVE state (current: ${offer.state})`,
      };
    }

    const transitioned = await this.stateMachine.transitionState(
      offerId,
      OfferState.ACTIVE,
      OfferState.MATCHED,
      matchSource,
      { cleanerId },
    );

    if (!transitioned) {
      this.logger.warn(
        `Match transition failed for offer ${offerId} — concurrent state change`,
      );
      return {
        success: false,
        reason: 'Transition failed — offer state changed concurrently',
      };
    }

    await this.offerRepo.update(offerId, { matchedAt: new Date() });

    this.logger.log(
      `Offer ${offerId} matched to cleaner ${cleanerId} via ${matchSource}`,
    );

    return { success: true };
  }
}
