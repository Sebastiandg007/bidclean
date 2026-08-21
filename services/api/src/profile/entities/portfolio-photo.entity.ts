import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Portfolio photo entity.
 * Stores portfolio image references for Cleaner users.
 * One-to-many relationship with users table (ON DELETE CASCADE).
 * Unique constraint on storage_key (uq_portfolio_photos_key).
 */
@Entity('portfolio_photos')
@Index('idx_portfolio_photos_order', ['userId', 'displayOrder'])
export class PortfolioPhoto {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_portfolio_photos_user')
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'storage_key', type: 'varchar', length: 512, unique: true })
  storageKey!: string;

  @Column({ name: 'display_order', type: 'integer', default: 0 })
  displayOrder!: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  caption!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
