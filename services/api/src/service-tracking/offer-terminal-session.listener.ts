import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import {
  OFFER_EVENT_NAMES,
  OfferCancelledEvent,
  OfferCompletedEvent,
  OfferExpiredEvent,
} from '../offers/events/offer-domain-events';
import { ServiceSessionService } from './service-session.service';
import { EndedReason } from './service-tracking.types';

/**
 * OfferTerminalSessionListener — force-cancels a non-terminal session when its offer becomes
 * terminal (Spec 17; mirrors voip's `OfferTerminalCallListener`).
 *
 * A decoupled `@OnEvent` listener reacting to offer cancellation/expiration/completion. It calls
 * `forceCancelForOffer(offerId, CANCELED_OFFER_TERMINAL)` idempotently (single-winner; a session
 * already terminal is a no-op) so a tracking session never outlives its match. Best-effort: a
 * failure is logged and never propagated (the sweep is the backstop), introducing no new coupling.
 */
@Injectable()
export class OfferTerminalSessionListener {
  private readonly logger = new Logger(OfferTerminalSessionListener.name);

  constructor(private readonly sessionService: ServiceSessionService) {}

  @OnEvent(OFFER_EVENT_NAMES.CANCELLED)
  async handleOfferCancelled(event: OfferCancelledEvent): Promise<void> {
    await this.forceCancelQuietly(event.offerId, OFFER_EVENT_NAMES.CANCELLED);
  }

  @OnEvent(OFFER_EVENT_NAMES.EXPIRED)
  async handleOfferExpired(event: OfferExpiredEvent): Promise<void> {
    await this.forceCancelQuietly(event.offerId, OFFER_EVENT_NAMES.EXPIRED);
  }

  @OnEvent(OFFER_EVENT_NAMES.COMPLETED)
  async handleOfferCompleted(event: OfferCompletedEvent): Promise<void> {
    await this.forceCancelQuietly(event.offerId, OFFER_EVENT_NAMES.COMPLETED);
  }

  /** Idempotent single-winner force-cancel, swallowing failures (the sweep is the backstop). */
  private async forceCancelQuietly(offerId: string, reason: string): Promise<void> {
    try {
      await this.sessionService.forceCancelForOffer(offerId, EndedReason.CANCELED_OFFER_TERMINAL);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Failed to force-cancel session for offer ${offerId} (${reason}): ${message}`);
    }
  }
}
