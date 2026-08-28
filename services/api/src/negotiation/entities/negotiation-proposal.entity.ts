import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Check,
  Unique,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { NegotiationThread } from './negotiation-thread.entity';

/**
 * Negotiation proposal entity.
 *
 * Maps to the `negotiation_proposals` table. A generic proposal authored by a
 * CLEANER or HOST actor within a thread. At most one PENDING proposal may exist
 * per thread (enforced by the partial unique index `uq_one_pending_per_thread`).
 * Only PENDING is mutable; all other statuses are terminal.
 */
@Entity('negotiation_proposals')
@Unique('uq_proposal_thread_sequence', ['threadId', 'sequenceNumber'])
@Check('chk_proposal_actor', `"actor" IN ('CLEANER', 'HOST')`)
@Check(
  'chk_proposal_status',
  `"status" IN ('PENDING', 'ACCEPTED', 'REJECTED', 'COUNTERED', 'SUPERSEDED', 'EXPIRED')`,
)
@Check(
  'chk_proposal_superseded_reason',
  `"superseded_reason" IS NULL OR "superseded_reason" IN ('OFFER_MATCHED', 'OFFER_CANCELLED', 'OFFER_EXPIRED', 'DIRECT_ACCEPT')`,
)
@Check('chk_proposal_price_positive', `"proposed_price_cents" > 0`)
@Index('idx_negotiation_proposals_thread', ['threadId'])
@Index('idx_negotiation_proposals_status', ['status'])
export class NegotiationProposal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Parent thread ID (FK CASCADE) */
  @Column({ name: 'thread_id', type: 'uuid' })
  threadId!: string;

  /** Who authored this proposal: CLEANER or HOST */
  @Column({ type: 'varchar', length: 10 })
  actor!: string;

  /** Strictly increasing position within the thread */
  @Column({ name: 'sequence_number', type: 'integer' })
  sequenceNumber!: number;

  /** Proposed price in cents (integer arithmetic only) */
  @Column({ name: 'proposed_price_cents', type: 'integer' })
  proposedPriceCents!: number;

  /** Derived Cleaner payout via CommissionService (offer's snapshotted rates) */
  @Column({ name: 'cleaner_payout_cents', type: 'integer' })
  cleanerPayoutCents!: number;

  /** Derived Host total via CommissionService (offer's snapshotted rates) */
  @Column({ name: 'host_total_cents', type: 'integer' })
  hostTotalCents!: number;

  /** ISO 4217 currency code */
  @Column({ type: 'char', length: 3 })
  currency!: string;

  /** Proposal lifecycle status (only PENDING is non-terminal) */
  @Column({ type: 'varchar', length: 12, default: 'PENDING' })
  status!: string;

  /** Reason a proposal was superseded (NULL unless status = SUPERSEDED) */
  @Column({ name: 'superseded_reason', type: 'varchar', length: 20, nullable: true })
  supersededReason!: string | null;

  /** When this proposal's response window elapses (created_at + response window) */
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  /** When the counterparty responded (NULL while PENDING) */
  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  /** Relation to the parent thread */
  @ManyToOne(() => NegotiationThread, (thread) => thread.proposals, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'thread_id' })
  thread!: NegotiationThread;
}
