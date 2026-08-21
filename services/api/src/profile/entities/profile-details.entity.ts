import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Profile details entity.
 * Stores common profile information for all users.
 * One-to-one relationship with users table (ON DELETE CASCADE).
 */
@Entity('profile_details')
export class ProfileDetails {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_profile_details_user', { unique: true })
  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 255 })
  displayName!: string;

  @Column({ name: 'phone_number', type: 'varchar', length: 20, nullable: true })
  phoneNumber!: string | null;

  @Column({ name: 'photo_storage_key', type: 'varchar', length: 512, nullable: true })
  photoStorageKey!: string | null;

  @Column({ type: 'text', nullable: true })
  bio!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
