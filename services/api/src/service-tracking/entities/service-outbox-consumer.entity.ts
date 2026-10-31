import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * Service outbox consumer entity (Spec 17).
 *
 * Maps to `service_outbox_consumers`: one row per `(event_id, consumer_name)` recording that a
 * specific downstream consumer (Spec 16 notifications, Spec 18 video) has durably processed a
 * `service_outbox` event. Each consumer drains only events with no row here for its own
 * `consumer_name`, then inserts one — at-least-once and idempotent PER consumer, independent of
 * every other consumer (no shared marker).
 */
@Entity('service_outbox_consumers')
@Unique('uq_service_outbox_consumers_event_consumer', ['eventId', 'consumerName'])
@Index('idx_service_outbox_consumers_consumer', ['consumerName'])
export class ServiceOutboxConsumer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** FK → service_outbox(event_id) ON DELETE CASCADE; part of the composite ack key. */
  @Column({ name: 'event_id', type: 'varchar', length: 255 })
  eventId!: string;

  /** The consumer identity (e.g. `notifications`, `video`). */
  @Column({ name: 'consumer_name', type: 'varchar', length: 50 })
  consumerName!: string;

  @CreateDateColumn({ name: 'processed_at', type: 'timestamptz' })
  processedAt!: Date;
}
