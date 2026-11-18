import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Dispute escrow-block intent entity (`dispute_escrow_intents`).
 *
 * The durable escrow-block command: `OPEN` on creation, `NONE` only after Spec 9 applies the
 * resolution's financial action (clear-escrow-LAST). `dispute_id` is `ON DELETE SET NULL` (NOT
 * cascade) and `payment_id` is `NOT NULL`, so a pending `NONE` clear survives the dispute's deletion
 * and the worker completes it keyed off `payment_id`. No `deleted_at` — it persists as audit.
 */
@Entity('dispute_escrow_intents')
@Check('chk_dispute_escrow_intents_target', `"target" IN ('OPEN', 'NONE')`)
@Check(
  'chk_dispute_escrow_intents_status',
  `"status" IN ('PENDING', 'DISPATCHED', 'ACCEPTED', 'FAILED_RETRYABLE')`,
)
@Index('idx_dispute_escrow_intents_dispute', ['disputeId'])
@Index('idx_dispute_escrow_intents_payment', ['paymentId'])
export class DisputeEscrowIntent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'dispute_id', type: 'uuid', nullable: true })
  disputeId!: string | null;

  @Column({ name: 'payment_id', type: 'uuid' })
  paymentId!: string;

  @Column({ type: 'varchar', length: 10 })
  target!: string;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: string;

  @Column({ type: 'integer', default: 0 })
  attempt!: number;

  @Column({ name: 'dispatched_at', type: 'timestamptz', nullable: true })
  dispatchedAt!: Date | null;

  @Column({ name: 'lease_until', type: 'timestamptz', nullable: true })
  leaseUntil!: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
