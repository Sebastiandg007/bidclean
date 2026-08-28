import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  OFFER_EVENT_NAMES,
  OfferMatchedEvent,
  OfferCancelledEvent,
  OfferExpiredEvent,
} from '../../offers/events/offer-domain-events';
import { NegotiationRepository } from '../negotiation.repository';
import { SupersededReason } from '../negotiation.types';

/**
 * Offer terminal-state listener.
 *
 * The SINGLE authority for superseding PENDING proposals when an offer becomes
 * terminal. Subscribes to the offer domain events emitted by offer-publishing:
 *
 * - offer.matched   -> supersede remaining PENDING proposals (OFFER_MATCHED)
 * - offer.cancelled -> supersede all PENDING proposals (OFFER_CANCELLED)
 * - offer.expired   -> supersede all PENDING proposals (OFFER_EXPIRED)
 *
 * On every terminal event it also closes the offer's threads. The winning
 * proposal (if any) was already set to ACCEPTED by NegotiationService inside the
 * accept transaction, so it is not PENDING and is untouched here. Supersession is
 * idempotent (only PENDING rows are affected).
 */
@Injectable()
export class OfferTerminalListener {
  private readonly logger = new Logger(OfferTerminalListener.name);

  constructor(private readonly negotiationRepo: NegotiationRepository) {}

  /** Handle ACTIVE -> MATCHED: supersede other PENDING proposals and close threads. */
  @OnEvent(OFFER_EVENT_NAMES.MATCHED)
  async handleOfferMatched(event: OfferMatchedEvent): Promise<void> {
    await this.supersedeAndClose(event.offerId, SupersededReason.OFFER_MATCHED);
  }

  /** Handle cancellation: supersede all PENDING proposals and close threads. */
  @OnEvent(OFFER_EVENT_NAMES.CANCELLED)
  async handleOfferCancelled(event: OfferCancelledEvent): Promise<void> {
    await this.supersedeAndClose(event.offerId, SupersededReason.OFFER_CANCELLED);
  }

  /** Handle expiration: supersede all PENDING proposals and close threads. */
  @OnEvent(OFFER_EVENT_NAMES.EXPIRED)
  async handleOfferExpired(event: OfferExpiredEvent): Promise<void> {
    await this.supersedeAndClose(event.offerId, SupersededReason.OFFER_EXPIRED);
  }

  /** Supersede all PENDING proposals for an offer and close its threads. */
  private async supersedeAndClose(offerId: string, reason: SupersededReason): Promise<void> {
    const superseded = await this.negotiationRepo.supersedePendingForOffer(offerId, reason);
    await this.negotiationRepo.closeThreadsForOffer(offerId);

    if (superseded > 0) {
      this.logger.debug(
        `Superseded ${superseded} pending proposal(s) for offer ${offerId} (${reason})`,
      );
    }
  }
}
