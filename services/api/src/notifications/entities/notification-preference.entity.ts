import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';

/**
 * `notification_preferences` — one row per user: per-category opt-in/out overrides plus a
 * quiet-hours window (with IANA timezone). An absent category override falls back to the
 * `NotificationType` metadata `defaultEnabled` (in application logic, never hardcoded).
 */
@Entity('notification_preferences')
@Unique('uq_notification_preferences_user', ['userId'])
export class NotificationPreference {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Owning user; FK -> users ON DELETE CASCADE. */
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  /** `{ [category]: false }` overrides; absent category uses metadata `defaultEnabled`. */
  @Column({ name: 'category_opt_out', type: 'jsonb', default: {} })
  categoryOptOut!: Record<string, boolean>;

  /** Local start of the do-not-disturb window (null = disabled). */
  @Column({ name: 'quiet_hours_start', type: 'time', nullable: true })
  quietHoursStart!: string | null;

  /** Local end of the do-not-disturb window. */
  @Column({ name: 'quiet_hours_end', type: 'time', nullable: true })
  quietHoursEnd!: string | null;

  /** IANA timezone for the quiet-hours window (e.g. America/Bogota). */
  @Column({ name: 'quiet_hours_timezone', type: 'varchar', length: 64, nullable: true })
  quietHoursTimezone!: string | null;

  /** BCP 47 language override; falls back to the user/profile language. */
  @Column({ type: 'varchar', length: 35, nullable: true })
  language!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
