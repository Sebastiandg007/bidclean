import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Check,
  Unique,
  OneToMany,
} from 'typeorm';
import { NegotiationProposal } from './negotiation-proposal.entity';

/**
 * Negotiation thread entity.
 *
 * Maps to the `negotiation_threads` table. One thread exists per
 * (offer, host, cleaner) combination. Holds the pointer to the current PENDING
 * proposal, a monotonic version for real-time event ordering, and the immutable
 * base_price_cents snapshot used as the deviation reference for all proposals.
 */
@Entity('negotiation_threads')
@Unique('uq_negotiation_thread', ['offerId', 'hostId', 'cleanerId'])
@Check('chk_thread_status', `"status" IN ('OPEN', 'CLOSED')`)
@Check('chk_thread_base_price', `"base_price_cents" > 0`)
@Index('idx_negotiation_threads_offer', ['offerId'])
@Index('idx_negotiation_threads_host', ['hostId'])
@Index('idx_negotiation_threads_cleaner', ['cleanerId'])
export class NegotiationThread {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Offer being negotiated (FK CASCADE — threads are meaningless without their offer) */
  @Column({ name: 'offer_id', type: 'uuid' })
  offerId!: string;

  /** Host who owns the offer (FK RESTRICT) */
  @Column({ name: 'host_id', type: 'uuid' })
  hostId!: string;

  /** Cleaner participating in this thread (FK RESTRICT) */
  @Column({ name: 'cleaner_id', type: 'uuid' })
  cleanerId!: string;

  /** Thread lifecycle: OPEN while offer is ACTIVE, CLOSED when the offer becomes terminal */
  @Column({ type: 'varchar', length: 20, default: 'OPEN' })
  status!: string;

  /** Pointer to the current PENDING proposal (NULL until first proposal) */
  @Column({ name: 'current_proposal_id', type: 'uuid', nullable: true })
  currentProposalId!: string | null;

  /** Count of every proposal ever created (including terminal ones) */
  @Column({ name: 'proposal_count', type: 'integer', default: 0 })
  proposalCount!: number;

  /** Monotonic version bumped on every mutation (real-time event ordering) */
  @Column({ type: 'integer', default: 0 })
  version!: number;

  /** Immutable snapshot of the offer's offered_price_cents at thread creation */
  @Column({ name: 'base_price_cents', type: 'integer' })
  basePriceCents!: number;

  /** ISO 4217 currency code inherited from the offer */
  @Column({ type: 'char', length: 3 })
  currency!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  /** Proposals belonging to this thread */
  @OneToMany(() => NegotiationProposal, (proposal) => proposal.thread)
  proposals!: NegotiationProposal[];
}
