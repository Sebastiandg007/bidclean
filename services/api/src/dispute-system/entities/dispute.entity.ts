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
 * Dispute entity (`disputes`).
 *
 * The durable dispute CASE + resolution bound to a service completion/offer — never the money
 * ledger. Partial-unique ACTIVE constraint (at most one OPEN/UNDER_REVIEW dispute per completion)
 * is a partial index defined in the migration (TypeORM cannot express it here). `phase` is derived
 * from Spec 9's authoritative `payout_status` and snapshotted at creation; deadlines are snapshotted
 * durable values. No `deleted_at` — a terminal dispute is an immutable audit fact.
 */
@Entity('disputes')
@Check('chk_disputes_initiator_role', `"initiator_role" IN ('HOST', 'CLEANER')`)
@Check('chk_disputes_phase', `"phase" IN ('PRE_RELEASE', 'POST_RELEASE')`)
@Check('chk_disputes_state', `"state" IN ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'EXPIRED')`)
@Check(
  'chk_disputes_resolution',
  `"resolution" IS NULL OR "resolution" IN ('FAVOR_CLEANER', 'FAVOR_HOST', 'PARTIAL')`,
)
@Check(
  'chk_disputes_terminal_resolution',
  `"state" NOT IN ('RESOLVED', 'EXPIRED') OR "resolution" IS NOT NULL`,
)
@Check(
  'chk_disputes_partial_amount',
  `"resolution" <> 'PARTIAL' OR "resolution_refund_cents" IS NOT NULL`,
)
@Index('idx_disputes_completion', ['serviceCompletionId'])
@Index('idx_disputes_offer', ['offerId'])
@Index('idx_disputes_payment', ['paymentId'])
export class Dispute {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'service_completion_id', type: 'uuid' })
  serviceCompletionId!: string;

  @Column({ name: 'offer_id', type: 'uuid' })
  offerId!: string;

  /** Reference by id to the escrow payment (Spec 9); no FK cascade from payments. */
  @Column({ name: 'payment_id', type: 'uuid' })
  paymentId!: string;

  @Column({ name: 'initiator_id', type: 'uuid', nullable: true })
  initiatorId!: string | null;

  @Column({ name: 'initiator_role', type: 'varchar', length: 10 })
  initiatorRole!: string;

  @Column({ name: 'host_id', type: 'uuid', nullable: true })
  hostId!: string | null;

  @Column({ name: 'cleaner_id', type: 'uuid', nullable: true })
  cleanerId!: string | null;

  @Column({ type: 'varchar', length: 15 })
  phase!: string;

  @Column({ name: 'reason_code', type: 'varchar', length: 40 })
  reasonCode!: string;

  @Column({ name: 'reason_text', type: 'text', nullable: true })
  reasonText!: string | null;

  @Column({ type: 'varchar', length: 15, default: 'OPEN' })
  state!: string;

  @Column({ type: 'varchar', length: 15, nullable: true })
  resolution!: string | null;

  @Column({ name: 'resolution_refund_cents', type: 'integer', nullable: true })
  resolutionRefundCents!: number | null;

  @Column({ name: 'evidence_deadline', type: 'timestamptz' })
  evidenceDeadline!: Date;

  @Column({ name: 'resolution_deadline', type: 'timestamptz' })
  resolutionDeadline!: Date;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @Column({ name: 'resolved_by', type: 'varchar', length: 255, nullable: true })
  resolvedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
