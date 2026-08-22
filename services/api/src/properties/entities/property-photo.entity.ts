import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Property } from './property.entity';

/**
 * Property photo entity.
 * Each record represents one uploaded photo for a property.
 * Display order is always contiguous (0, 1, 2, ...) — maintained via transactional operations.
 * The cover photo is always display_order = 0.
 */
@Entity('property_photos')
@Unique('uq_property_photos_key', ['storageKey'])
@Index('idx_property_photos_property', ['propertyId'])
@Index('idx_property_photos_order', ['propertyId', 'displayOrder'])
export class PropertyPhoto {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Parent property ID — FK with CASCADE on delete */
  @Column({ name: 'property_id', type: 'uuid' })
  propertyId!: string;

  /** MinIO object storage key (unique across all photos) */
  @Column({ name: 'storage_key', type: 'varchar', length: 512 })
  storageKey!: string;

  /** File MIME type (image/jpeg, image/png, image/webp) */
  @Column({ name: 'mime_type', type: 'varchar', length: 50 })
  mimeType!: string;

  /** File size in bytes (for auditing and validation) */
  @Column({ name: 'file_size_bytes', type: 'integer' })
  fileSizeBytes!: number;

  /** Display order position (0-indexed, contiguous) */
  @Column({ name: 'display_order', type: 'integer', default: 0 })
  displayOrder!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  /** Relation to parent property */
  @ManyToOne(() => Property, (property) => property.photos, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'property_id' })
  property!: Property;
}
