import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import {
  DISPUTE_CREATION_DRAIN_BATCH_SIZE,
  DISPUTE_CREATION_DRAIN_INTERVAL_MS,
  DISPUTE_OUTBOX_CONSUMER_NAME,
  SERVICE_DISPUTED_EVENT_TYPE,
} from '../dispute.constants';
import { toServiceDisputedPayload } from '../dispute.types';
import { CompletionOutboxConsumerCheckpoint } from '../repository/completion-outbox-consumer.checkpoint';
import { DisputeCreationService } from '../service/dispute-creation.service';

/**
 * DisputeCreatedConsumer — drains the durable `service_disputed` event (Spec 21).
 *
 * dispute-system is a consumer of service-completion's `completion_outbox` fan-out, so it drains via
 * its OWN per-consumer checkpoint (`consumer_name = 'dispute'`), coexisting with the Push (Spec 16)
 * consumer on the same events. For each unacked `service_disputed` row it calls
 * `createFromRouting(payload)` (idempotent on the partial-unique active + `disputeId`) then acks only
 * its own `(event_id, 'dispute')` row. A row-scoped catch isolates a failure from the source
 * completion routing and leaves the row re-drainable (the ack is only written on success). Never a
 * synchronous call and never a mobile `POST /disputes`.
 */
@Injectable()
export class DisputeCreatedConsumer {
  private readonly logger = new Logger(DisputeCreatedConsumer.name);

  constructor(
    private readonly checkpoint: CompletionOutboxConsumerCheckpoint,
    private readonly creation: DisputeCreationService,
  ) {}

  /** Static so the decorator can read the configured interval. */
  static getIntervalMs(): number {
    return DISPUTE_CREATION_DRAIN_INTERVAL_MS;
  }

  @Interval(DisputeCreatedConsumer.getIntervalMs())
  async drain(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      // Tests drive `drainOnce()` directly; no scheduled draining under test.
      return;
    }
    await this.drainOnce();
  }

  /** One bounded drain pass. Each row is handled independently (row-scoped failure isolation). */
  async drainOnce(): Promise<void> {
    const rows = await this.checkpoint.drainUnacked(
      DISPUTE_OUTBOX_CONSUMER_NAME,
      DISPUTE_CREATION_DRAIN_BATCH_SIZE,
    );
    for (const row of rows) {
      if (row.type !== SERVICE_DISPUTED_EVENT_TYPE) {
        await this.ackQuietly(row.eventId);
        continue;
      }
      await this.consumeRow(row.eventId, row.payload);
    }
  }

  /** Create the dispute then ack; on failure leave the row re-drainable (no ack written). */
  private async consumeRow(eventId: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.creation.createFromRouting(toServiceDisputedPayload(payload));
      await this.checkpoint.ack(eventId, DISPUTE_OUTBOX_CONSUMER_NAME);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Dispute creation failed for ${eventId} (re-drainable): ${reason}`);
    }
  }

  /** Ack an unrelated event type, swallowing failures (it re-drains and re-acks next pass). */
  private async ackQuietly(eventId: string): Promise<void> {
    try {
      await this.checkpoint.ack(eventId, DISPUTE_OUTBOX_CONSUMER_NAME);
    } catch {
      // No-op; a failed ack simply re-drains next pass (idempotent).
    }
  }
}
