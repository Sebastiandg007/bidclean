import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * User settings entity.
 * Stores per-user preferences (language, theme, notifications).
 * One-to-one relationship with users table (ON DELETE CASCADE).
 */
@Entity('user_settings')
export class UserSettings {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_user_settings_user', { unique: true })
  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId!: string;

  @Column({ type: 'varchar', length: 35, default: 'en' })
  language!: string;

  @Column({ type: 'varchar', length: 10, default: 'system' })
  theme!: string;

  @Column({ name: 'is_push_enabled', type: 'boolean', default: true })
  isPushEnabled!: boolean;

  @Column({ name: 'is_email_notifications_enabled', type: 'boolean', default: true })
  isEmailNotificationsEnabled!: boolean;

  @Column({ name: 'is_sounds_enabled', type: 'boolean', default: true })
  isSoundsEnabled!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
