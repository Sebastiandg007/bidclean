import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * Service outbox entity (Spec 17).
 *
 * Maps to `service_outbox`: durable `service_*` transition events written in the same transaction
 * as the single-winner state change. It is a fan-out source with NO shared `relayed_at`;
 * per-consumer progress lives in `service_outbox_consumers`.
 */
@Entity('service_outbox')
@Unique('uq_service_outbox_event', ['eventId'])
@Index('idx_service_outbox_created', ['createdAt'])
export class ServiceOutbox {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Deterministic UNIQUE id per transition (e.g. `service_arrived:{sessionId}`); the fan-out key. */
  @Column({ name: 'event_id', type: 'varchar', length: 255 })
  eventId!: string;

  @Column({ name: 'aggregate_type', type: 'varchar', length: 30, default: 'service_session' })
  aggregateType!: string;

  @Column({ name: 'aggregate_id', type: 'uuid' })
  aggregateId!: string;

  @Column({ type: 'varchar', length: 50 })
  type!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
