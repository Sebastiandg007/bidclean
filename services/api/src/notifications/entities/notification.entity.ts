import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';
import type { DeepLink } from '../notifications.types';

/**
 * `notifications` — the delivery ledger; one row per notification INTENT for a recipient
 * (NOT one row per device delivery). `dedup_key` (UNIQUE) is the exactly-once intent guarantee.
 * `SENT` means at least one successful provider submission for this intent (external delivery is
 * at-least-once/best-effort). There is intentionally no `deleted_at` (retention-window prune).
 */
@Entity('notifications')
@Unique('uq_notifications_dedup', ['dedupKey'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Recipient user; FK -> users ON DELETE CASCADE. */
  @Index('idx_notifications_recipient_created')
  @Column({ name: 'recipient_user_id', type: 'uuid' })
  recipientUserId!: string;

  /** Notification type (matches an outbox type / NotificationType). */
  @Column({ type: 'varchar', length: 50 })
  type!: string;

  /** Category (from NotificationType metadata). */
  @Column({ type: 'varchar', length: 30 })
  category!: string;

  /** Delivery medium; modeled for future EMAIL/SMS. */
  @Column({ type: 'varchar', length: 20, default: 'PUSH' })
  channel!: string;

  /** UNIQUE — derived from the outbox event_id + version + recipient (exactly-once intent). */
  @Column({ name: 'dedup_key', type: 'varchar', length: 255 })
  dedupKey!: string;

  /** Typed id-based deep-link { type, ...ids }; ids only, never sensitive content. */
  @Column({ name: 'deep_link', type: 'jsonb' })
  deepLink!: DeepLink;

  /** Minimal reference for content rendering (ids/labels only). */
  @Column({ name: 'payload_ref', type: 'jsonb', nullable: true })
  payloadRef!: Record<string, string> | null;

  /** HIGH | NORMAL | LOW (from metadata). */
  @Column({ type: 'varchar', length: 10 })
  priority!: string;

  /** PENDING | PROCESSING | SENT | FAILED_RETRYABLE | FAILED_FINAL | SUPPRESSED. */
  @Index('idx_notifications_status')
  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: string;

  /** no-device | opted-out | quiet-hours | foreground (audit only). */
  @Column({ name: 'suppression_reason', type: 'varchar', length: 30, nullable: true })
  suppressionReason!: string | null;

  /** Delivery attempt count. */
  @Column({ type: 'integer', default: 0 })
  attempt!: number;

  /** Set on SENT. */
  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
