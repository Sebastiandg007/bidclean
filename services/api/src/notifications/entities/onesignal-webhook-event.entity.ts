import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Unique,
} from 'typeorm';

/**
 * `onesignal_webhook_events` — webhook idempotency ledger. A redelivered OneSignal callback
 * (same `provider_event_id`) is a no-op and never re-mutates the ledger/registry.
 */
@Entity('onesignal_webhook_events')
@Unique('uq_onesignal_webhook_provider_event', ['providerEventId'])
export class OnesignalWebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** UNIQUE — OneSignal's own event id. */
  @Column({ name: 'provider_event_id', type: 'varchar', length: 255 })
  providerEventId!: string;

  /** Delivery / subscription-change discriminator. */
  @Column({ name: 'event_type', type: 'varchar', length: 50 })
  eventType!: string;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt!: Date;
}
