import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
  OneToOne,
  Index,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';

/**
 * Cleaner profile entity.
 * Stores onboarding data for users with the Cleaner role.
 * One-to-one relationship with User (a user can have at most one cleaner profile).
 */
@Entity('cleaner_profiles')
export class CleanerProfile {
  /** Unique identifier (UUID v4, auto-generated) */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Reference to the owning user */
  @Index('idx_cleaner_profiles_user', { unique: true })
  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId!: string;

  /** Display name visible to Hosts */
  @Column({ name: 'display_name', type: 'varchar', length: 255 })
  displayName!: string;

  /** Work zone center latitude (nullable until set during onboarding) */
  @Column({ name: 'work_zone_lat', type: 'double precision', nullable: true })
  workZoneLat!: number | null;

  /** Work zone center longitude (nullable until set during onboarding) */
  @Column({ name: 'work_zone_lng', type: 'double precision', nullable: true })
  workZoneLng!: number | null;

  /** Work zone radius in kilometers (nullable until set during onboarding) */
  @Column({ name: 'work_zone_radius_km', type: 'double precision', nullable: true })
  workZoneRadiusKm!: number | null;

  /** Availability schedule as JSON (days/hours the cleaner works) */
  @Column({ name: 'availability', type: 'jsonb', default: '{}' })
  availability!: Record<string, unknown>;

  /** Cleaning specialties (e.g., Airbnb, offices, homes, post-event) */
  @Column({ name: 'specialties', type: 'varchar', array: true, default: '{}' })
  specialties!: string[];

  /** Whether the cleaner has uploaded portfolio photos */
  @Column({ name: 'has_portfolio', type: 'boolean', default: false })
  hasPortfolio!: boolean;

  /** Whether a bank account has been added for payouts (MVP flag, Stripe is source of truth) */
  @Column({ name: 'bank_account_added', type: 'boolean', default: false })
  bankAccountAdded!: boolean;

  /** Timestamp when the profile was created */
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  /** Timestamp when the profile was last updated */
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  /** Relation to User entity */
  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;
}
