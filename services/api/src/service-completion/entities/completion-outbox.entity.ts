import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * Completion outbox entity (`completion_outbox`).
 *
 * Durable `service_confirmed` / `service_disputed` / `service_rated` facts written in the SAME
 * transaction as their transition. A fan-out source drained by Push (Spec 16), disputes (Spec 21),
 * and reputation (Spec 22) via their own per-consumer checkpoints — so this row carries NO shared
 * `relayed_at`. `event_id` is UNIQUE and deterministic per transition.
 */
@Entity('completion_outbox')
@Unique('uq_completion_outbox_event', ['eventId'])
@Index('idx_completion_outbox_created', ['createdAt'])
export class CompletionOutbox {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Deterministic, globally-unique id for the fact (the dedup key). */
  @Column({ name: 'event_id', type: 'varchar', length: 255 })
  eventId!: string;

  /** Aggregate kind (app-validated short code). */
  @Column({ name: 'aggregate_type', type: 'varchar', length: 30, default: 'service_completion' })
  aggregateType!: string;

  /** The `service_completions.id` this fact is about. */
  @Column({ name: 'aggregate_id', type: 'uuid' })
  aggregateId!: string;

  /** The event type discriminator. */
  @Column({ type: 'varchar', length: 50 })
  type!: string;

  /** Minimal payload (ids/enums/routing fields); no secrets, no PII. */
  @Column({ type: 'jsonb' })
  payload!: unknown;

  /** Payload schema/version. */
  @Column({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
