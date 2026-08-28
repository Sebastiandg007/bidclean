import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Check,
  Unique,
} from 'typeorm';

/**
 * Payment entity.
 *
 * Maps to the `payments` table — the escrow aggregate, one row per matched offer.
 * Holds the money snapshot (from CommissionService) and three orthogonal lifecycles
 * (payment_status, dispute_status, payout_status). Stripe intent/charge ids live on
 * `payment_attempts`; the payout Transfer id lives here.
 */
@Entity('payments')
@Unique('uq_payment_offer', ['offerId'])
@Check(
  'chk_payment_status',
  `"payment_status" IN ('PENDING','PROCESSING','HELD','RELEASED','REFUNDED','PARTIALLY_REFUNDED','FAILED')`,
)
@Check('chk_dispute_status', `"dispute_status" IN ('NONE','OPEN','WON','LOST')`)
@Check(
  'chk_payout_status',
  `"payout_status" IN ('NOT_READY','PENDING','TRANSFER_CREATED','PAID','REVERSED')`,
)
@Check(
  'chk_amounts_positive',
  `"agreed_price_cents" > 0 AND "host_total_cents" > 0 AND "cleaner_payout_cents" >= 0`,
)
@Check(
  'chk_refund_ceiling',
  `"refunded_amount_cents" >= 0 AND "refunded_amount_cents" <= "host_total_cents"`,
)
@Check(
  'chk_reversal_ceiling',
  `"reversed_amount_cents" >= 0 AND "reversed_amount_cents" <= "cleaner_payout_cents"`,
)
@Index('idx_payments_host', ['hostId'])
@Index('idx_payments_cleaner', ['cleanerId'])
@Index('idx_payments_status', ['paymentStatus'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Offer being paid for (FK RESTRICT) */
  @Column({ name: 'offer_id', type: 'uuid' })
  offerId!: string;

  /** Host charged for the service (FK RESTRICT) */
  @Column({ name: 'host_id', type: 'uuid' })
  hostId!: string;

  /** Cleaner paid for the service (FK RESTRICT) */
  @Column({ name: 'cleaner_id', type: 'uuid' })
  cleanerId!: string;

  /** Financial lifecycle status */
  @Column({ name: 'payment_status', type: 'varchar', length: 20, default: 'PENDING' })
  paymentStatus!: string;

  /** Dispute lifecycle status (orthogonal to payment_status) */
  @Column({ name: 'dispute_status', type: 'varchar', length: 10, default: 'NONE' })
  disputeStatus!: string;

  /** Payout lifecycle status (orthogonal to payment_status) */
  @Column({ name: 'payout_status', type: 'varchar', length: 20, default: 'NOT_READY' })
  payoutStatus!: string;

  /** ISO 4217 currency code inherited from the offer */
  @Column({ type: 'char', length: 3 })
  currency!: string;

  /** Agreed price in cents (negotiated match or offered price) */
  @Column({ name: 'agreed_price_cents', type: 'integer' })
  agreedPriceCents!: number;

  /** Total charged to the Host in cents */
  @Column({ name: 'host_total_cents', type: 'integer' })
  hostTotalCents!: number;

  /** Net payout transferred to the Cleaner in cents */
  @Column({ name: 'cleaner_payout_cents', type: 'integer' })
  cleanerPayoutCents!: number;

  /** Platform gross revenue in cents (host_total - cleaner_payout, before Stripe fees) */
  @Column({ name: 'platform_gross_revenue_cents', type: 'integer' })
  platformGrossRevenueCents!: number;

  /** Stripe processing fee in cents (recorded on capture from the balance transaction) */
  @Column({ name: 'stripe_fee_cents', type: 'integer', default: 0 })
  stripeFeeCents!: number;

  /** Net platform revenue in cents (gross - stripe_fee - adjustments) */
  @Column({ name: 'net_platform_revenue_cents', type: 'integer', default: 0 })
  netPlatformRevenueCents!: number;

  /** Sum of Refunds issued to the Host in cents */
  @Column({ name: 'refunded_amount_cents', type: 'integer', default: 0 })
  refundedAmountCents!: number;

  /** Sum of Transfer Reversals recovered from the Cleaner in cents */
  @Column({ name: 'reversed_amount_cents', type: 'integer', default: 0 })
  reversedAmountCents!: number;

  /** Stripe payout Transfer id (NULL until a Transfer is created) */
  @Column({ name: 'stripe_transfer_id', type: 'varchar', length: 255, nullable: true })
  stripeTransferId!: string | null;

  /** When funds became held in escrow (auto-release clock start) */
  @Column({ name: 'held_at', type: 'timestamptz', nullable: true })
  heldAt!: Date | null;

  /** When the payout was released */
  @Column({ name: 'released_at', type: 'timestamptz', nullable: true })
  releasedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
