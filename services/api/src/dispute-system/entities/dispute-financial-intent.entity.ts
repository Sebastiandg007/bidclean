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
 * Dispute financial-action intent entity (`dispute_financial_intents`).
 *
 * The durable money-effect command (release/refund) drained into Spec 9 with idempotent retries.
 * `dispute_id` is `ON DELETE SET NULL` (NOT cascade) and `payment_id` is `NOT NULL`, so a pending
 * money effect survives the dispute's deletion and the worker completes it keyed off `payment_id`.
 * `ACTION_BLOCKED` is the durable needs-review terminal for a Spec 9 `BLOCKED` outcome (money NOT
 * moved). `effective_amount_cents` is the authoritative amount Spec 9 actually applied.
 */
@Entity('dispute_financial_intents')
@Check(
  'chk_dispute_financial_intents_action',
  `"action" IN ('RELEASE', 'FULL_REFUND', 'PARTIAL_REFUND')`,
)
@Check(
  'chk_dispute_financial_intents_amount',
  `"amount_cents" IS NULL OR "amount_cents" >= 0`,
)
@Check(
  'chk_dispute_financial_intents_status',
  `"status" IN ('PENDING', 'DISPATCHED', 'ACCEPTED', 'FAILED_RETRYABLE', 'ACTION_BLOCKED')`,
)
@Check(
  'chk_dispute_financial_intents_outcome',
  `"outcome" IS NULL OR "outcome" IN ('APPLIED', 'CEILING_CLAMPED', 'NO_OP', 'BLOCKED')`,
)
@Check(
  'chk_dispute_financial_intents_partial_amount',
  `"action" <> 'PARTIAL_REFUND' OR "amount_cents" IS NOT NULL`,
)
@Index('idx_dispute_financial_intents_dispute', ['disputeId'])
@Index('idx_dispute_financial_intents_payment', ['paymentId'])
export class DisputeFinancialIntent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'dispute_id', type: 'uuid', nullable: true })
  disputeId!: string | null;

  @Column({ name: 'payment_id', type: 'uuid' })
  paymentId!: string;

  @Column({ type: 'varchar', length: 20 })
  action!: string;

  @Column({ name: 'amount_cents', type: 'integer', nullable: true })
  amountCents!: number | null;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: string;

  @Column({ type: 'integer', default: 0 })
  attempt!: number;

  @Column({ name: 'dispatched_at', type: 'timestamptz', nullable: true })
  dispatchedAt!: Date | null;

  @Column({ name: 'lease_until', type: 'timestamptz', nullable: true })
  leaseUntil!: Date | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  outcome!: string | null;

  @Column({ name: 'outcome_reason', type: 'varchar', length: 40, nullable: true })
  outcomeReason!: string | null;

  @Column({ name: 'effective_amount_cents', type: 'integer', nullable: true })
  effectiveAmountCents!: number | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
