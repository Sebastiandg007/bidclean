import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Unique,
  Check,
} from 'typeorm';
import { DispatchStatus, RevenueCatEventType, Store } from '../subscriptions.types';

/**
 * Subscription event entity — maps to the append-only `subscription_events` ledger + outbox.
 *
 * One sanitized row per RevenueCat webhook (no tokens/receipts/PII). `dispatchStatus` is the
 * delivery outbox lifecycle: RECEIVED (committed before ACK) -> QUEUED -> PROCESSED, or FAILED.
 * There is deliberately NO FK to `users` so audit history survives account deletion (`userId`
 * is nullable and anonymized to NULL). `revenuecatEventId` is UNIQUE — the dedup guarantee.
 */
@Entity('subscription_events')
@Unique('uq_subscription_event_rc_id', ['revenuecatEventId'])
@Index('idx_subscription_events_user', ['userId', 'createdAt'])
@Index('idx_subscription_events_type', ['eventType'])
@Check(
  'chk_subscription_event_dispatch',
  `"dispatch_status" IN ('RECEIVED','QUEUED','PROCESSED','FAILED')`,
)
export class SubscriptionEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** RevenueCat's event id — the dedup key (UNIQUE) */
  @Column({ name: 'revenuecat_event_id', type: 'varchar', length: 255 })
  revenuecatEventId!: string;

  /** Resolved app_user_id; NOT a FK (audit survives deletion; anonymized to NULL) */
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  /** The RevenueCat event type (may be an unrecognized value; recorded verbatim) */
  @Column({ name: 'event_type', type: 'varchar', length: 40 })
  eventType!: RevenueCatEventType | string;

  /** Logical entitlement keys touched by the event */
  @Column({ name: 'entitlement_ids', type: 'varchar', array: true, length: 40, default: '{}' })
  entitlementIds!: string[];

  /** Purchase source reported by the event */
  @Column({ type: 'varchar', length: 20, nullable: true })
  store!: Store | null;

  /** RevenueCat event time in epoch ms (per-entitlement ordering) */
  @Column({ name: 'event_timestamp_ms', type: 'bigint' })
  eventTimestampMs!: string;

  /** Entitlement expiration carried by the event, if any */
  @Column({ name: 'expiration_at', type: 'timestamptz', nullable: true })
  expirationAt!: Date | null;

  /** Sanitized payload (whitelisted safe fields only) */
  @Column({ name: 'payload_json', type: 'jsonb' })
  payloadJson!: Record<string, unknown>;

  /** Delivery outbox state */
  @Column({ name: 'dispatch_status', type: 'varchar', length: 12, default: DispatchStatus.RECEIVED })
  dispatchStatus!: DispatchStatus;

  /** When the mirror was successfully applied for this event */
  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
