import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * Dispute outbox entity (`dispute_outbox`).
 *
 * Durable `dispute_opened` / `dispute_resolved` facts written in the SAME transaction as their
 * transition. A fan-out source drained by push-notifications (Spec 16) via its own per-consumer
 * checkpoint — so this row carries NO shared `relayed_at`. `event_id` is UNIQUE and deterministic.
 */
@Entity('dispute_outbox')
@Unique('uq_dispute_outbox_event', ['eventId'])
@Index('idx_dispute_outbox_created', ['createdAt'])
export class DisputeOutbox {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_id', type: 'varchar', length: 255 })
  eventId!: string;

  @Column({ name: 'aggregate_type', type: 'varchar', length: 30, default: 'dispute' })
  aggregateType!: string;

  @Column({ name: 'aggregate_id', type: 'uuid' })
  aggregateId!: string;

  @Column({ type: 'varchar', length: 50 })
  type!: string;

  @Column({ type: 'jsonb' })
  payload!: unknown;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
