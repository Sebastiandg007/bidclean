import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import {
  OFFER_EVENT_NAMES,
  OfferCancelledEvent,
  OfferCompletedEvent,
  OfferExpiredEvent,
  OfferMatchedEvent,
} from '../../offers/events/offer-domain-events';
import { ChatService } from '../chat.service';

/**
 * Closes chat conversations when their offer becomes terminal (match invalidation).
 *
 * Mirrors how negotiation (`OfferTerminalListener`) and payments react to offer domain events:
 * a decoupled `@OnEvent` listener in the consuming module, not a direct call from offers. On
 * cancellation/expiration/completion the offer's conversations are CLOSED (new sends rejected,
 * history still readable). MATCHED does NOT close — a match is exactly when chat becomes usable.
 * Closing is idempotent and best-effort: a failure is logged and never propagated, and the
 * negotiation reconciliation sweep plus these same events provide self-healing.
 */
@Injectable()
export class OfferTerminalChatListener {
  private readonly logger = new Logger(OfferTerminalChatListener.name);

  constructor(private readonly chatService: ChatService) {}

  /** Cancellation → close the offer's conversations. */
  @OnEvent(OFFER_EVENT_NAMES.CANCELLED)
  async handleOfferCancelled(event: OfferCancelledEvent): Promise<void> {
    await this.closeQuietly(event.offerId, OFFER_EVENT_NAMES.CANCELLED);
  }

  /** Expiration → close the offer's conversations. */
  @OnEvent(OFFER_EVENT_NAMES.EXPIRED)
  async handleOfferExpired(event: OfferExpiredEvent): Promise<void> {
    await this.closeQuietly(event.offerId, OFFER_EVENT_NAMES.EXPIRED);
  }

  /** Completion → close the offer's conversations (service finished). */
  @OnEvent(OFFER_EVENT_NAMES.COMPLETED)
  async handleOfferCompleted(event: OfferCompletedEvent): Promise<void> {
    await this.closeQuietly(event.offerId, OFFER_EVENT_NAMES.COMPLETED);
  }

  /**
   * MATCHED is observed but intentionally a no-op: a matched offer is precisely when the
   * conversation should be usable, so it stays OPEN. Declared so the intent is explicit.
   */
  @OnEvent(OFFER_EVENT_NAMES.MATCHED)
  handleOfferMatched(_event: OfferMatchedEvent): void {
    // No-op by design: matching opens chat; it does not close it.
  }

  /** Close the offer's conversations, swallowing failures (best-effort lifecycle). */
  private async closeQuietly(offerId: string, reason: string): Promise<void> {
    try {
      await this.chatService.closeConversationsForOffer(offerId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Failed to close chat conversations for offer ${offerId} (${reason}): ${message}`);
    }
  }
}
