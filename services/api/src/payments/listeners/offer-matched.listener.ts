import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OFFER_EVENT_NAMES, OfferMatchedEvent } from '../../offers/events/offer-domain-events';
import { EscrowChargeService } from '../escrow/escrow-charge.service';

/**
 * Offer-matched listener.
 *
 * Subscribes to `offer.matched` and delegates to the escrow charge service. Errors
 * are logged and swallowed so a charge failure never breaks the emitter chain — the
 * charge service itself records FAILED state and emits `payment.failed`.
 */
@Injectable()
export class OfferMatchedListener {
  private readonly logger = new Logger(OfferMatchedListener.name);

  constructor(private readonly chargeService: EscrowChargeService) {}

  @OnEvent(OFFER_EVENT_NAMES.MATCHED)
  async handleOfferMatched(event: OfferMatchedEvent): Promise<void> {
    try {
      await this.chargeService.chargeForOffer({
        offerId: event.offerId,
        hostId: event.hostId,
        cleanerId: event.cleanerId,
      });
    } catch (error) {
      this.logger.error(`Failed to handle offer.matched for ${event.offerId}: ${String(error)}`);
    }
  }
}
