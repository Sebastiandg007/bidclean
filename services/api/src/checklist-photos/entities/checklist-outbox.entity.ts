import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * Checklist outbox entity (`checklist_outbox`).
 *
 * Durable `checklist_completed` facts written in the SAME transaction as the run
 * `ACTIVE → COMPLETED` transition. A fan-out source drained by Spec 20/21 via their own
 * per-consumer checkpoints — so this row carries NO shared `relayed_at`. `event_id` is UNIQUE and
 * deterministic per transition (`checklist_completed:{runId}`).
 */
@Entity('checklist_outbox')
@Unique('uq_checklist_outbox_event', ['eventId'])
@Index('idx_checklist_outbox_created', ['createdAt'])
export class ChecklistOutbox {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Deterministic, globally-unique id for the fact (the dedup key). */
  @Column({ name: 'event_id', type: 'varchar', length: 255 })
  eventId!: string;

  /** Aggregate kind (app-validated short code). */
  @Column({ name: 'aggregate_type', type: 'varchar', length: 30, default: 'checklist_run' })
  aggregateType!: string;

  /** The `checklist_runs.id` this fact is about. */
  @Column({ name: 'aggregate_id', type: 'uuid' })
  aggregateId!: string;

  /** The event type discriminator (`checklist_completed`). */
  @Column({ type: 'varchar', length: 50 })
  type!: string;

  /** Minimal payload (totals + photo count); no bytes, no PII. */
  @Column({ type: 'jsonb' })
  payload!: unknown;

  /** Payload schema/version. */
  @Column({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
