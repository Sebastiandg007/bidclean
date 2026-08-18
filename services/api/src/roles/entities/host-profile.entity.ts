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
 * Host profile entity.
 * Stores onboarding data for users with the Host role.
 * One-to-one relationship with User (a user can have at most one host profile).
 */
@Entity('host_profiles')
export class HostProfile {
  /** Unique identifier (UUID v4, auto-generated) */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Reference to the owning user */
  @Index('idx_host_profiles_user', { unique: true })
  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId!: string;

  /** Display name visible to Cleaners */
  @Column({ name: 'display_name', type: 'varchar', length: 255 })
  displayName!: string;

  /** Whether the Host operates as a business entity */
  @Column({ name: 'is_business', type: 'boolean', default: false })
  isBusiness!: boolean;

  /** Business name (nullable, relevant only when isBusiness is true) */
  @Column({ name: 'business_name', type: 'varchar', length: 255, nullable: true })
  businessName!: string | null;

  /** Whether a payment method has been registered (MVP flag, Stripe is source of truth) */
  @Column({ name: 'payment_method_added', type: 'boolean', default: false })
  paymentMethodAdded!: boolean;

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
