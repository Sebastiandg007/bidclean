import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

/**
 * Stripe account entity.
 *
 * Maps to the `stripe_accounts` table. One Express Connected Account per Cleaner.
 * Capability flags (`payouts_enabled`) gate payouts (Property P6). Reconciliation
 * repairs these flags periodically without relying solely on `account.updated`.
 */
@Entity('stripe_accounts')
@Unique('uq_stripe_account_cleaner', ['cleanerId'])
@Unique('uq_stripe_account_id', ['stripeAccountId'])
@Index('idx_stripe_accounts_cleaner', ['cleanerId'])
export class StripeAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Cleaner who owns this account (FK CASCADE) */
  @Column({ name: 'cleaner_id', type: 'uuid' })
  cleanerId!: string;

  /** Stripe Connected Account id (acct_...) */
  @Column({ name: 'stripe_account_id', type: 'varchar', length: 255 })
  stripeAccountId!: string;

  /** Whether the account can accept charges */
  @Column({ name: 'charges_enabled', type: 'boolean', default: false })
  chargesEnabled!: boolean;

  /** Whether the account can receive payouts (the payout gate) */
  @Column({ name: 'payouts_enabled', type: 'boolean', default: false })
  payoutsEnabled!: boolean;

  /** Whether the Cleaner submitted all onboarding details */
  @Column({ name: 'details_submitted', type: 'boolean', default: false })
  detailsSubmitted!: boolean;

  /** Account country (ISO 3166-1 alpha-2) */
  @Column({ type: 'char', length: 2, nullable: true })
  country!: string | null;

  /** Account default currency (ISO 4217) */
  @Column({ name: 'default_currency', type: 'char', length: 3, nullable: true })
  defaultCurrency!: string | null;

  /** When capability flags were last synced from Stripe */
  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
