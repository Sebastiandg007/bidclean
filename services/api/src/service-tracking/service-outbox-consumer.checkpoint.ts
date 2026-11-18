import { Injectable } from '@nestjs/common';

import { ServiceSessionRepository, UnackedOutboxRow } from './service-session.repository';

/**
 * ServiceOutboxConsumerCheckpoint — the per-consumer draining primitive over `service_outbox`
 * (Spec 17, the fan-out seam).
 *
 * `drainUnacked(consumerName, batch)` selects `service_outbox` rows with NO
 * `service_outbox_consumers` row for `consumerName` (a `NOT EXISTS` scan), and `ack(eventId,
 * consumerName)` inserts the ack (`ON CONFLICT (event_id, consumer_name) DO NOTHING`). Because each
 * consumer tracks its own `(event_id, consumer_name)` progress, the Spec 16 notifications consumer
 * and the Spec 18 video consumer each receive `service_arrived` independently — one acking never
 * marks it processed for the other, and there is no shared marker a single consumer could flip.
 * Delivery is at-least-once and idempotent PER consumer.
 */
@Injectable()
export class ServiceOutboxConsumerCheckpoint {
  constructor(private readonly repository: ServiceSessionRepository) {}

  /** Rows this consumer has not yet acked (oldest-first, bounded). */
  async drainUnacked(consumerName: string, batch: number): Promise<UnackedOutboxRow[]> {
    return this.repository.findOutboxUnackedFor(consumerName, batch);
  }

  /** Record this consumer's ack of an event (idempotent per `(event_id, consumer_name)`). */
  async ack(eventId: string, consumerName: string): Promise<void> {
    await this.repository.ackOutboxFor(eventId, consumerName);
  }
}
