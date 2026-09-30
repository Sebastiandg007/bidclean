import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** A `completion_outbox` row a consumer has not yet acked. */
export interface UnackedCompletionOutboxRow {
  readonly eventId: string;
  readonly type: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
}

/**
 * CompletionOutboxConsumerCheckpoint — the per-consumer draining primitive over service-completion's
 * `completion_outbox` fan-out (Spec 20 emits it; dispute-system is a consumer, Spec 21).
 *
 * `drainUnacked(consumerName, batch)` selects `completion_outbox` rows with NO
 * `completion_outbox_consumers` row for `consumerName` (a `NOT EXISTS` scan), and `ack(eventId,
 * consumerName)` inserts the ack (`ON CONFLICT (event_id, consumer_name) DO NOTHING`). Mirrors the
 * `ChecklistOutboxConsumerCheckpoint` pattern exactly, but over `completion_outbox` — so the Push
 * (Spec 16) consumer and this dispute consumer each drain independently. Delivery is at-least-once
 * and idempotent PER consumer. Parameterized SQL only; read-only over the completion tables.
 */
@Injectable()
export class CompletionOutboxConsumerCheckpoint {
  constructor(private readonly dataSource: DataSource) {}

  /** Rows this consumer has not yet acked (oldest-first, bounded). */
  async drainUnacked(consumerName: string, batch: number): Promise<UnackedCompletionOutboxRow[]> {
    const rows = await this.dataSource.query<
      Array<{ event_id: string; type: string; aggregate_id: string; payload: Record<string, unknown> }>
    >(
      `SELECT o."event_id", o."type", o."aggregate_id", o."payload"
       FROM "completion_outbox" o
       WHERE NOT EXISTS (
         SELECT 1 FROM "completion_outbox_consumers" c
         WHERE c."event_id" = o."event_id" AND c."consumer_name" = $1
       )
       ORDER BY o."created_at" ASC
       LIMIT $2`,
      [consumerName, batch],
    );
    return rows.map((row) => ({
      eventId: row.event_id,
      type: row.type,
      aggregateId: row.aggregate_id,
      payload: row.payload,
    }));
  }

  /** Record this consumer's ack of an event (idempotent per `(event_id, consumer_name)`). */
  async ack(eventId: string, consumerName: string): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO "completion_outbox_consumers" ("event_id", "consumer_name")
       VALUES ($1, $2)
       ON CONFLICT ("event_id", "consumer_name") DO NOTHING`,
      [eventId, consumerName],
    );
  }
}
