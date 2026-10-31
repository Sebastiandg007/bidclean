import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import {
  OFFER_EVENT_NAMES,
  OfferCancelledEvent,
  OfferCompletedEvent,
  OfferExpiredEvent,
} from '../../offers/events/offer-domain-events';
import { ChatRepository } from '../chat.repository';
import { EndReason } from './voip.constants';
import { VoipService } from './voip.service';

/**
 * Force-ends non-terminal calls when their offer becomes terminal (match invalidation).
 *
 * Mirrors `OfferTerminalChatListener`: a decoupled `@OnEvent` listener that reacts to offer
 * cancellation/expiration/completion. Where the chat listener CLOSES the conversation, this one
 * force-ends any in-flight call on each of that offer's conversations (single-winner terminal write,
 * `CONVERSATION_CLOSED`) so a call never outlives its match. Idempotent and best-effort: a failure
 * is logged and never propagated (the stale-call sweep is the backstop). A new initiate on a now-
 * CLOSED conversation is already rejected by `VoipService.initiate` (the OPEN check).
 */
@Injectable()
export class OfferTerminalCallListener {
  private readonly logger = new Logger(OfferTerminalCallListener.name);

  constructor(
    private readonly voipService: VoipService,
    private readonly chatRepository: ChatRepository,
  ) {}

  /** Cancellation → force-end the offer's active calls. */
  @OnEvent(OFFER_EVENT_NAMES.CANCELLED)
  async handleOfferCancelled(event: OfferCancelledEvent): Promise<void> {
    await this.forceEndQuietly(event.offerId, OFFER_EVENT_NAMES.CANCELLED);
  }

  /** Expiration → force-end the offer's active calls. */
  @OnEvent(OFFER_EVENT_NAMES.EXPIRED)
  async handleOfferExpired(event: OfferExpiredEvent): Promise<void> {
    await this.forceEndQuietly(event.offerId, OFFER_EVENT_NAMES.EXPIRED);
  }

  /** Completion → force-end the offer's active calls (service finished). */
  @OnEvent(OFFER_EVENT_NAMES.COMPLETED)
  async handleOfferCompleted(event: OfferCompletedEvent): Promise<void> {
    await this.forceEndQuietly(event.offerId, OFFER_EVENT_NAMES.COMPLETED);
  }

  /**
   * Force-end every non-terminal call on each of the offer's conversations, swallowing failures.
   * Resolves the offer's conversation ids from the chat repository (calls are keyed by conversation)
   * and delegates each to the idempotent, single-winner `forceEndForConversation`.
   */
  private async forceEndQuietly(offerId: string, reason: string): Promise<void> {
    try {
      const conversationIds = await this.chatRepository.findConversationIdsForOffer(offerId);
      for (const conversationId of conversationIds) {
        await this.voipService.forceEndForConversation(
          conversationId,
          EndReason.CONVERSATION_CLOSED,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Failed to force-end calls for offer ${offerId} (${reason}): ${message}`);
    }
  }
}
