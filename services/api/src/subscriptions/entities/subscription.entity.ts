import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
  Check,
} from 'typeorm';
import { Store } from '../subscriptions.types';

/**
 * Subscription mirror entity — maps to the `subscriptions` table (one row per user).
 *
 * A durable, reconcilable projection of RevenueCat entitlement state. Each entitlement has its
 * own active/expiry/store snapshot plus a per-entitlement `lastEventAt` used as the
 * out-of-order guard. Runtime authorization MUST evaluate `active AND (expiresAt IS NULL OR
 * expiresAt > now)`; the `active` flag alone is a replicated RevenueCat state, not authority.
 */
@Entity('subscriptions')
@Unique('uq_subscriptions_user', ['userId'])
@Index('idx_subscriptions_user', ['userId'])
@Index('idx_subscriptions_reconcile', ['lastReconciledAt'])
@Check(
  'chk_sub_cleaner_store',
  `"cleaner_pro_store" IS NULL OR "cleaner_pro_store" IN ('app_store','play_store','amazon','stripe','promotional')`,
)
@Check(
  'chk_sub_host_store',
  `"host_pro_store" IS NULL OR "host_pro_store" IN ('app_store','play_store','amazon','stripe','promotional')`,
)
@Check(
  'chk_sub_adfree_store',
  `"ad_free_store" IS NULL OR "ad_free_store" IN ('app_store','play_store','amazon','stripe','promotional')`,
)
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** = RevenueCat app_user_id (internal user UUID); FK users ON DELETE CASCADE */
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  /** Whether RevenueCat reports the cleaner_pro entitlement active */
  @Column({ name: 'cleaner_pro_active', type: 'boolean', default: false })
  cleanerProActive!: boolean;

  /** cleaner_pro expiry (null = open-ended); authorization compares against now */
  @Column({ name: 'cleaner_pro_expires_at', type: 'timestamptz', nullable: true })
  cleanerProExpiresAt!: Date | null;

  /** Purchase source of cleaner_pro */
  @Column({ name: 'cleaner_pro_store', type: 'varchar', length: 20, nullable: true })
  cleanerProStore!: Store | null;

  /** Per-entitlement out-of-order guard for cleaner_pro (latest applied event time) */
  @Column({ name: 'cleaner_pro_last_event_at', type: 'timestamptz', nullable: true })
  cleanerProLastEventAt!: Date | null;

  /** Whether RevenueCat reports the host_pro entitlement active */
  @Column({ name: 'host_pro_active', type: 'boolean', default: false })
  hostProActive!: boolean;

  /** host_pro expiry (null = open-ended) */
  @Column({ name: 'host_pro_expires_at', type: 'timestamptz', nullable: true })
  hostProExpiresAt!: Date | null;

  /** Purchase source of host_pro */
  @Column({ name: 'host_pro_store', type: 'varchar', length: 20, nullable: true })
  hostProStore!: Store | null;

  /** Per-entitlement out-of-order guard for host_pro */
  @Column({ name: 'host_pro_last_event_at', type: 'timestamptz', nullable: true })
  hostProLastEventAt!: Date | null;

  /** Whether RevenueCat reports the ad_free entitlement active (never implies PRO) */
  @Column({ name: 'ad_free_active', type: 'boolean', default: false })
  adFreeActive!: boolean;

  /** ad_free expiry (null = open-ended) */
  @Column({ name: 'ad_free_expires_at', type: 'timestamptz', nullable: true })
  adFreeExpiresAt!: Date | null;

  /** Purchase source of ad_free */
  @Column({ name: 'ad_free_store', type: 'varchar', length: 20, nullable: true })
  adFreeStore!: Store | null;

  /** Per-entitlement out-of-order guard for ad_free */
  @Column({ name: 'ad_free_last_event_at', type: 'timestamptz', nullable: true })
  adFreeLastEventAt!: Date | null;

  /** Last full reconcile against RevenueCat (distinct from per-entitlement event times) */
  @Column({ name: 'last_reconciled_at', type: 'timestamptz', nullable: true })
  lastReconciledAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
