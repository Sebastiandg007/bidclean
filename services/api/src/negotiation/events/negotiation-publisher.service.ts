import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CentrifugoClient } from '../../offers/delivery/centrifugo.client';
import { NEGOTIATION_CHANNELS } from '../negotiation.constants';
import {
  NEGOTIATION_EVENT_NAMES,
  NegotiationEvent,
  NegotiationEventName,
  OfferStatusChangedEvent,
} from './negotiation-events';

/** Parameters shared by every negotiation event publish */
export interface PublishParams {
  readonly threadId: string;
  readonly proposalId: string;
  readonly offerId: string;
  readonly version: number;
  readonly sequenceNumber: number;
}

/**
 * Negotiation publisher.
 *
 * Publishes negotiation events to correctly scoped Centrifugo channels:
 * - `negotiation:host:{hostId}` — events for the Host's own offers
 * - `negotiation:cleaner:{cleanerId}` — events for that Cleaner's own thread
 * - `offers:cleaner:{cleanerId}` — `offer_status_changed{MATCHED}` to OTHER Cleaners
 *   so their radar pins are removed
 *
 * Privacy: a losing Cleaner receives only the `offer_status_changed{MATCHED}`
 * event with no negotiation detail or winner identity.
 *
 * Reliability: publish failures are logged and swallowed — they NEVER roll back
 * persisted negotiation state (REST is the source of truth for reconciliation).
 */
@Injectable()
export class NegotiationPublisher {
  private readonly logger = new Logger(NegotiationPublisher.name);

  constructor(private readonly centrifugo: CentrifugoClient) {}

  /** Publish a proposal-created event to the Host's channel. */
  async publishProposalCreatedToHost(hostId: string, params: PublishParams): Promise<void> {
    await this.publishToChannel(
      NEGOTIATION_CHANNELS.host(hostId),
      this.buildEvent(NEGOTIATION_EVENT_NAMES.PROPOSAL_CREATED, params),
    );
  }

  /** Publish a proposal-countered event to the Cleaner's channel. */
  async publishProposalCounteredToCleaner(cleanerId: string, params: PublishParams): Promise<void> {
    await this.publishToChannel(
      NEGOTIATION_CHANNELS.cleaner(cleanerId),
      this.buildEvent(NEGOTIATION_EVENT_NAMES.PROPOSAL_COUNTERED, params),
    );
  }

  /** Publish a proposal-rejected event to a specific counterparty channel. */
  async publishProposalRejected(
    channel: string,
    params: PublishParams,
  ): Promise<void> {
    await this.publishToChannel(
      channel,
      this.buildEvent(NEGOTIATION_EVENT_NAMES.PROPOSAL_REJECTED, params),
    );
  }

  /** Publish a proposal-accepted event to the winning counterparty channel. */
  async publishProposalAccepted(channel: string, params: PublishParams): Promise<void> {
    await this.publishToChannel(
      channel,
      this.buildEvent(NEGOTIATION_EVENT_NAMES.PROPOSAL_ACCEPTED, params),
    );
  }

  /**
   * Publish `offer_status_changed{MATCHED}` to the radar channels of OTHER Cleaners
   * so their pins clear. The winner is excluded.
   *
   * @param otherCleanerIds - Cleaner IDs (excluding the winner) who received the offer
   * @param offerId - The matched offer ID
   */
  async publishOfferMatchedToOtherCleaners(
    otherCleanerIds: string[],
    offerId: string,
  ): Promise<void> {
    if (otherCleanerIds.length === 0) {
      return;
    }

    const channels = otherCleanerIds.map((id) => NEGOTIATION_CHANNELS.offersCleaner(id));
    const event: OfferStatusChangedEvent = {
      type: 'offer_status_changed',
      offerId,
      state: 'MATCHED',
      changedAt: new Date().toISOString(),
    };

    try {
      await this.centrifugo.broadcast(channels, event);
    } catch (error) {
      this.logger.warn(
        `Failed to broadcast offer_status_changed{MATCHED} for offer ${offerId}: ${String(error)}`,
      );
    }
  }

  /** Build a negotiation event envelope with a fresh eventId and timestamp. */
  private buildEvent(type: NegotiationEventName, params: PublishParams): NegotiationEvent {
    return {
      eventId: randomUUID(),
      type,
      threadId: params.threadId,
      proposalId: params.proposalId,
      offerId: params.offerId,
      version: params.version,
      sequenceNumber: params.sequenceNumber,
      occurredAt: new Date().toISOString(),
    };
  }

  /** Publish to a single channel, swallowing (logging) any failure. */
  private async publishToChannel(channel: string, event: NegotiationEvent): Promise<void> {
    try {
      await this.centrifugo.publish(channel, event);
    } catch (error) {
      this.logger.warn(
        `Failed to publish ${event.type} to ${channel} (eventId ${event.eventId}): ${String(error)}`,
      );
    }
  }
}
