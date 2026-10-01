import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import {
  OFFER_EVENT_NAMES,
  OfferCancelledEvent,
  OfferCompletedEvent,
  OfferExpiredEvent,
} from '../../offers/events/offer-domain-events';
import { AbandonReason } from '../checklist.types';
import { ChecklistRunService } from '../service/checklist-run.service';

/**
 * OfferTerminalChecklistListener — force-ABANDONS an ACTIVE checklist run when its offer becomes
 * terminal (Spec 19; mirrors service-tracking's `OfferTerminalSessionListener`).
 *
 * A decoupled `@OnEvent` listener reacting to the offer's officially-defined terminal events
 * (cancellation/expiration/completion) — it reacts to those durable events, never a locally
 * duplicated copy of Spec 17's state machine. It calls `forceAbandonForOffer` idempotently
 * (single-winner; a run already terminal is a no-op). Best-effort: a failure is logged and never
 * propagated (the stuck-run sweep is the backstop), introducing no new coupling.
 */
@Injectable()
export class OfferTerminalChecklistListener {
  private readonly logger = new Logger(OfferTerminalChecklistListener.name);

  constructor(private readonly runService: ChecklistRunService) {}

  @OnEvent(OFFER_EVENT_NAMES.CANCELLED)
  async handleOfferCancelled(event: OfferCancelledEvent): Promise<void> {
    await this.forceAbandonQuietly(event.offerId, OFFER_EVENT_NAMES.CANCELLED);
  }

  @OnEvent(OFFER_EVENT_NAMES.EXPIRED)
  async handleOfferExpired(event: OfferExpiredEvent): Promise<void> {
    await this.forceAbandonQuietly(event.offerId, OFFER_EVENT_NAMES.EXPIRED);
  }

  @OnEvent(OFFER_EVENT_NAMES.COMPLETED)
  async handleOfferCompleted(event: OfferCompletedEvent): Promise<void> {
    await this.forceAbandonQuietly(event.offerId, OFFER_EVENT_NAMES.COMPLETED);
  }

  /** Idempotent single-winner force-abandon, swallowing failures (the sweep is the backstop). */
  private async forceAbandonQuietly(offerId: string, reason: string): Promise<void> {
    try {
      await this.runService.forceAbandonForOffer(offerId, AbandonReason.OFFER_TERMINAL);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Failed to abandon checklist run for offer ${offerId} (${reason}): ${message}`);
    }
  }
}
