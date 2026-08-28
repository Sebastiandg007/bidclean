import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Check,
} from 'typeorm';

/**
 * Payment event entity.
 *
 * Maps to the `payment_events` table — an append-only, sanitized ledger for audit,
 * webhook idempotency (unique `stripe_event_id`, Property P8), and idempotency-key
 * traceability. `payload_json` NEVER contains card data, client secrets, or raw PII
 * (see the sanitizer in `payment-payload.sanitizer.ts`).
 */
@Entity('payment_events')
@Check('chk_payment_event_source', `"source" IN ('api','webhook')`)
@Index('idx_payment_events_payment', ['paymentId'])
@Index('idx_payment_events_type', ['eventType'])
export class PaymentEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Related payment (NULL for events that precede the payment link, e.g. account.updated) */
  @Column({ name: 'payment_id', type: 'uuid', nullable: true })
  paymentId!: string | null;

  /** Origin of the event: 'api' (our request) or 'webhook' (Stripe) */
  @Column({ type: 'varchar', length: 20 })
  source!: string;

  /** Event type (e.g. payment_intent.succeeded, transfer.created, charge.dispute.created) */
  @Column({ name: 'event_type', type: 'varchar', length: 80 })
  eventType!: string;

  /** Stripe event id for webhook dedup (NULL for api-sourced events) */
  @Column({ name: 'stripe_event_id', type: 'varchar', length: 255, nullable: true })
  stripeEventId!: string | null;

  /** Idempotency key used on the Stripe request (audit) */
  @Column({ name: 'idempotency_key', type: 'varchar', length: 255, nullable: true })
  idempotencyKey!: string | null;

  /** Amount associated with the event in cents (NULL if not applicable) */
  @Column({ name: 'amount_cents', type: 'integer', nullable: true })
  amountCents!: number | null;

  /** ISO 4217 currency code (NULL if not applicable) */
  @Column({ type: 'char', length: 3, nullable: true })
  currency!: string | null;

  /** Sanitized snapshot of the event (whitelisted fields only) */
  @Column({ name: 'payload_json', type: 'jsonb' })
  payloadJson!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
