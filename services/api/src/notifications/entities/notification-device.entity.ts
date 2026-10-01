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
 * `notification_devices` — Model B per-device subscription registry.
 *
 * Each row is ONE device's OneSignal subscription for a user. Sends target the consented,
 * non-stale `onesignal_player_id`s (never a blanket external-user-id fan-out).
 */
@Entity('notification_devices')
@Unique('uq_notification_devices_user_player', ['userId', 'onesignalPlayerId'])
export class NotificationDevice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Owning user; FK -> users ON DELETE CASCADE (notification data is user-owned). */
  @Index('idx_notification_devices_user')
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  /** Device platform (app-validated IOS | ANDROID | WEB). */
  @Column({ type: 'varchar', length: 10 })
  platform!: string;

  /** The per-device subscription id; the actual per-send target (Model B). */
  @Column({ name: 'onesignal_player_id', type: 'varchar', length: 255 })
  onesignalPlayerId!: string;

  /** Equals `userId`; used for OneSignal tags/segments only, never as a target. */
  @Column({ name: 'onesignal_external_user_id', type: 'varchar', length: 255 })
  onesignalExternalUserId!: string;

  /** Per-device consent. */
  @Column({ name: 'consent_granted', type: 'boolean', default: false })
  consentGranted!: boolean;

  /** True when OneSignal reported the player id invalid; excluded from targeting. */
  @Column({ name: 'is_stale', type: 'boolean', default: false })
  isStale!: boolean;

  /** Updated on register/ping. */
  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
