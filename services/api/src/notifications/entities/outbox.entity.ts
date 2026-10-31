import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Read-model base for the five per-domain outbox tables. The notifications relay only READS these
 * tables (each is owned/written by its emitting domain). All five share an identical shape, so a
 * shared abstract base is mapped to concrete `@Entity` classes below, one per physical table.
 */
export abstract class OutboxEntityBase {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Deterministic UNIQUE id per business fact; source of the ledger dedup key. */
  @Column({ name: 'event_id', type: 'varchar', length: 255 })
  eventId!: string;

  /** Aggregate kind (e.g. offer, payment, message, call) — app-validated short code. */
  @Column({ name: 'aggregate_type', type: 'varchar', length: 30 })
  aggregateType!: string;

  /** The fact's entity id (offer/payment/message/call). */
  @Column({ name: 'aggregate_id', type: 'uuid' })
  aggregateId!: string;

  /** Event type discriminator (e.g. offer.matched, message-created, call-invited). */
  @Column({ type: 'varchar', length: 50 })
  type!: string;

  /** Minimal ids/labels needed to build the intent (no sensitive content). */
  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  /** Payload schema/version; part of the dedup derivation. */
  @Column({ type: 'integer', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  /** Set by the relay after the intent is durably persisted (NULL = not yet relayed). */
  @Column({ name: 'relayed_at', type: 'timestamptz', nullable: true })
  relayedAt!: Date | null;
}

/** `offer_outbox` read-model. */
@Entity('offer_outbox')
export class OfferOutbox extends OutboxEntityBase {}

/** `payment_outbox` read-model. */
@Entity('payment_outbox')
export class PaymentOutbox extends OutboxEntityBase {}

/** `negotiation_outbox` read-model. */
@Entity('negotiation_outbox')
export class NegotiationOutbox extends OutboxEntityBase {}

/** `chat_outbox` read-model. */
@Entity('chat_outbox')
export class ChatOutbox extends OutboxEntityBase {}

/** `voip_outbox` read-model. */
@Entity('voip_outbox')
export class VoipOutbox extends OutboxEntityBase {}
