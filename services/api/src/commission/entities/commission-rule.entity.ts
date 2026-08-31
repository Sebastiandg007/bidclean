import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Check,
} from 'typeorm';
import { RateSide, SubscriberTier } from '../commission.types';

/**
 * Commission rule entity — maps to the `commission_rules` table.
 *
 * A versioned, scoped rule that sets exactly ONE side (`appliesTo`) via a single
 * `rateBps`. NULL scope columns mean "ANY". Rates are integer basis points. Overlap
 * of identical-scope active rules is prevented by the `excl_commission_rule_overlap`
 * GiST exclusion constraint defined in the migration. Rules are never physically deleted.
 */
@Entity('commission_rules')
@Check('chk_commission_applies_to', `"applies_to" IN ('HOST','CLEANER')`)
@Check('chk_commission_tier', `"subscriber_tier" IS NULL OR "subscriber_tier" IN ('FREE','PRO')`)
@Check('chk_commission_rate_bps', `"rate_bps" >= 0 AND "rate_bps" <= 10000`)
@Index('idx_commission_rules_lookup', ['appliesTo', 'isActive', 'effectiveFrom'])
export class CommissionRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** ISO 3166-1 alpha-2 country scope, or null = ANY */
  @Column({ type: 'char', length: 2, nullable: true })
  country!: string | null;

  /** Subscriber-tier scope (FREE|PRO), or null = ANY */
  @Column({ name: 'subscriber_tier', type: 'varchar', length: 10, nullable: true })
  subscriberTier!: SubscriberTier | null;

  /** Service-type scope, or null = ANY */
  @Column({ name: 'service_type', type: 'varchar', length: 30, nullable: true })
  serviceType!: string | null;

  /** The single side this rule sets: HOST or CLEANER */
  @Column({ name: 'applies_to', type: 'varchar', length: 10 })
  appliesTo!: RateSide;

  /** Rate in basis points (integer, 0..10000) */
  @Column({ name: 'rate_bps', type: 'integer' })
  rateBps!: number;

  /** Selection priority (higher wins after specificity) */
  @Column({ type: 'integer', default: 0 })
  priority!: number;

  /** Inclusive start of the effective window */
  @Column({ name: 'effective_from', type: 'timestamptz' })
  effectiveFrom!: Date;

  /** Exclusive end of the effective window, or null = open-ended */
  @Column({ name: 'effective_to', type: 'timestamptz', nullable: true })
  effectiveTo!: Date | null;

  /** Whether the rule participates in resolution */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  /** Actor who created the rule (FK users SET NULL) */
  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  /** Actor who last modified the rule (FK users SET NULL) */
  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
