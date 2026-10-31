import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * Verification-outbox entity.
 *
 * Maps to `verification_outbox`, the durable result-event table written in the SAME transaction as
 * the terminal state transition. It is a fan-out source drained by push-notifications (Spec 16) via
 * its own per-consumer checkpoint — so it carries NO shared `relayedAt`. Payloads are minimal ids +
 * derived fields (the raw `matchScore` is internal and never forwarded to the Host surface).
 */
@Entity('verification_outbox')
@Unique('uq_verification_outbox_event', ['eventId'])
@Index('idx_verification_outbox_created', ['createdAt'])
export class VerificationOutbox {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Deterministic per-transition id (e.g. `verification_completed:{verificationId}`) */
  @Column({ name: 'event_id', type: 'varchar', length: 255 })
  eventId!: string;

  @Column({ name: 'aggregate_type', type: 'varchar', length: 30, default: 'verification_session' })
  aggregateType!: string;

  @Column({ name: 'aggregate_id', type: 'uuid' })
  aggregateId!: string;

  /** `verification_completed` | `verification_flagged` */
  @Column({ type: 'varchar', length: 50 })
  type!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
