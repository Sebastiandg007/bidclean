import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Check,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Offer } from './offer.entity';

/**
 * Offer state transition entity.
 *
 * Maps to the `offer_state_transitions` audit table.
 * Records every lifecycle state change for an offer with timestamp, actor, and metadata.
 * Used for the state timeline display, debugging, and compliance auditing.
 * Immutable once created — transitions are append-only.
 */
@Entity('offer_state_transitions')
@Check('chk_from_state', `"from_state" IS NULL OR "from_state" IN ('DRAFT', 'PUBLISHED', 'ACTIVE', 'MATCHED', 'COMPLETED', 'CANCELLED', 'EXPIRED')`)
@Check('chk_to_state', `"to_state" IN ('DRAFT', 'PUBLISHED', 'ACTIVE', 'MATCHED', 'COMPLETED', 'CANCELLED', 'EXPIRED')`)
@Index('idx_offer_transitions_offer', ['offerId'])
@Index('idx_offer_transitions_offer_time', ['offerId', 'createdAt'])
export class OfferStateTransition {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Parent offer ID — FK with CASCADE (transitions are meaningless without their offer) */
  @Column({ name: 'offer_id', type: 'uuid' })
  offerId!: string;

  /** Previous state before the transition (NULL for initial creation: → DRAFT) */
  @Column({ name: 'from_state', type: 'varchar', length: 20, nullable: true })
  fromState!: string | null;

  /** Target state after the transition */
  @Column({ name: 'to_state', type: 'varchar', length: 20 })
  toState!: string;

  /** Who or what triggered this transition (e.g., 'host', 'system', 'scheduler', 'cleaner') */
  @Column({ name: 'triggered_by', type: 'varchar', length: 50 })
  triggeredBy!: string;

  /** Optional context payload (e.g., cancellation reason, expansion step, matched cleaner ID) */
  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  /** Relation to the parent offer */
  @ManyToOne(() => Offer, (offer) => offer.stateTransitions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'offer_id' })
  offer!: Offer;
}
