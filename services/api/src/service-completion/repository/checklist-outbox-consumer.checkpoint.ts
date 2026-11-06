import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** A `checklist_outbox` row a consumer has not yet acked. */
export interface UnackedChecklistOutboxRow {
  readonly eventId: string;
  readonly type: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
}

/**
 * ChecklistOutboxConsumerCheckpoint — the per-consumer draining primitive over checklist-photos'
 * `checklist_outbox` fan-out (Spec 19 emits it; service-completion is the first consumer).
 *
 * `drainUnacked(consumerName, batch)` selects `checklist_outbox` rows with NO
 * `checklist_outbox_consumers` row for `consumerName` (a `NOT EXISTS` scan), and `ack(eventId,
 * consumerName)` inserts the ack (`ON CONFLICT (event_id, consumer_name) DO NOTHING`). Mirrors
 * Spec 17's `ServiceOutboxConsumerCheckpoint` exactly, but over `checklist_outbox` — so the Spec 20
 * completion consumer and any future Spec 21 dispute-evidence consumer each drain independently.
 * Delivery is at-least-once and idempotent PER consumer. Parameterized SQL only; read-only over the
 * checklist tables (never mutates a run or a shared marker).
 */
@Injectable()
export class ChecklistOutboxConsumerCheckpoint {
  constructor(private readonly dataSource: DataSource) {}

  /** Rows this consumer has not yet acked (oldest-first, bounded). */
  async drainUnacked(consumerName: string, batch: number): Promise<UnackedChecklistOutboxRow[]> {
    const rows = await this.dataSource.query<
      Array<{ event_id: string; type: string; aggregate_id: string; payload: Record<string, unknown> }>
    >(
      `SELECT o."event_id", o."type", o."aggregate_id", o."payload"
       FROM "checklist_outbox" o
       WHERE NOT EXISTS (
         SELECT 1 FROM "checklist_outbox_consumers" c
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
      `INSERT INTO "checklist_outbox_consumers" ("event_id", "consumer_name")
       VALUES ($1, $2)
       ON CONFLICT ("event_id", "consumer_name") DO NOTHING`,
      [eventId, consumerName],
    );
  }
}
