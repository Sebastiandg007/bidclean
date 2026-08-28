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
import { Payment } from './payment.entity';

/**
 * Payment attempt entity.
 *
 * Maps to the `payment_attempts` table. One row per PaymentIntent (charge attempt).
 * A payment aggregates 1..N attempts; a retry after FAILED adds a new attempt rather
 * than mutating a prior attempt's Stripe ids. At most one SUCCEEDED attempt may exist
 * per payment (enforced by the partial unique index `uq_one_succeeded_attempt`).
 */
@Entity('payment_attempts')
@Unique('uq_attempt_payment_number', ['paymentId', 'attemptNumber'])
@Unique('uq_attempt_intent', ['stripePaymentIntentId'])
@Check('chk_attempt_status', `"status" IN ('PROCESSING','SUCCEEDED','FAILED')`)
@Index('idx_payment_attempts_payment', ['paymentId'])
export class PaymentAttempt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Parent payment id (FK CASCADE) */
  @Column({ name: 'payment_id', type: 'uuid' })
  paymentId!: string;

  /** Strictly increasing attempt number within the payment */
  @Column({ name: 'attempt_number', type: 'integer' })
  attemptNumber!: number;

  /** Stripe PaymentIntent id for this attempt */
  @Column({ name: 'stripe_payment_intent_id', type: 'varchar', length: 255 })
  stripePaymentIntentId!: string;

  /** Stripe Charge id (NULL until the charge succeeds) */
  @Column({ name: 'stripe_charge_id', type: 'varchar', length: 255, nullable: true })
  stripeChargeId!: string | null;

  /** Attempt lifecycle status */
  @Column({ type: 'varchar', length: 12, default: 'PROCESSING' })
  status!: string;

  /** Failure reason when status = FAILED (NULL otherwise) */
  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason!: string | null;

  /** Amount charged in cents */
  @Column({ name: 'amount_cents', type: 'integer' })
  amountCents!: number;

  /** ISO 4217 currency code */
  @Column({ type: 'char', length: 3 })
  currency!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  /** Relation to the parent payment */
  @ManyToOne(() => Payment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'payment_id' })
  payment!: Payment;
}
