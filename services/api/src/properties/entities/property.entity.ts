import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Check,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { PropertyPhoto } from './property-photo.entity';
import { User } from '../../auth/entities/user.entity';

/**
 * Property entity.
 * Represents a physical space registered by a Host where cleaning services are performed.
 * Uses PostGIS GEOGRAPHY(Point, 4326) for spatial storage.
 * Soft delete via deleted_at column.
 */
@Entity('properties')
@Check('chk_type', `"type" IN ('apartment', 'house', 'office', 'airbnb', 'commercial_space', 'other')`)
@Check('chk_country', `"address_country" IN ('CO', 'US', 'CA', 'GB', 'DE', 'FR', 'IT', 'ES', 'PT', 'NL')`)
@Check('chk_sqm', `"square_meters" > 0`)
@Check('chk_bedrooms', `"bedrooms" >= 0`)
@Check('chk_bathrooms', `"bathrooms" >= 1`)
@Check('chk_location_source', `"location_source" IN ('GEOCODED', 'MANUAL')`)
@Index('idx_properties_user', ['userId'])
@Index('idx_properties_type', ['type'])
export class Property {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Owner user ID — FK with CASCADE on hard delete */
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  /** Property display name */
  @Column({ type: 'varchar', length: 100 })
  name!: string;

  /** Property type: apartment, house, office, airbnb, commercial_space, other */
  @Column({ type: 'varchar', length: 30 })
  type!: string;

  /** Optional property description */
  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** Street address (private — never exposed in public view) */
  @Column({ name: 'address_street', type: 'varchar', length: 255 })
  addressStreet!: string;

  /** City (exposed in public view) */
  @Column({ name: 'address_city', type: 'varchar', length: 100 })
  addressCity!: string;

  /** State/province (private — never exposed in public view) */
  @Column({ name: 'address_state', type: 'varchar', length: 100, nullable: true })
  addressState!: string | null;

  /** Postal code (private — never exposed in public view) */
  @Column({ name: 'address_postal_code', type: 'varchar', length: 20, nullable: true })
  addressPostalCode!: string | null;

  /** Country code ISO 3166-1 alpha-2 */
  @Column({ name: 'address_country', type: 'char', length: 2 })
  addressCountry!: string;

  /**
   * PostGIS geography point (SRID 4326).
   * Stored as WKT, queried via ST_MakePoint.
   * NOTE: TypeORM does not natively handle PostGIS — use raw queries for spatial ops.
   */
  @Column({ type: 'geography', spatialFeatureType: 'Point', srid: 4326 })
  location!: string;

  /** Formatted address from geocoding (private — always treated as private data) */
  @Column({ name: 'formatted_address', type: 'varchar', length: 500, nullable: true })
  formattedAddress!: string | null;

  /** How coordinates were obtained: GEOCODED or MANUAL */
  @Column({ name: 'location_source', type: 'varchar', length: 20 })
  locationSource!: string;

  /** Property size in square meters */
  @Column({ name: 'square_meters', type: 'numeric', precision: 8, scale: 2 })
  squareMeters!: number;

  /** Number of bedrooms (0 for studio/office) */
  @Column({ type: 'integer', default: 0 })
  bedrooms!: number;

  /** Number of bathrooms (minimum 1) */
  @Column({ type: 'integer', default: 1 })
  bathrooms!: number;

  /** Floor number (nullable for houses) */
  @Column({ name: 'floor_number', type: 'integer', nullable: true })
  floorNumber!: number | null;

  /** Has parking available */
  @Column({ name: 'has_parking', type: 'boolean', default: false })
  hasParking!: boolean;

  /** Has elevator access */
  @Column({ name: 'has_elevator', type: 'boolean', default: false })
  hasElevator!: boolean;

  /** Special requirements array */
  @Column({ name: 'special_requirements', type: 'varchar', array: true, default: '{}' })
  specialRequirements!: string[];

  /** Cleaning checklist items */
  @Column({ name: 'checklist_items', type: 'varchar', array: true, default: '{}' })
  checklistItems!: string[];

  /** Access instructions (private — revealed only after match) */
  @Column({ name: 'access_instructions', type: 'text', nullable: true })
  accessInstructions!: string | null;

  /** Soft delete timestamp (NULL = active) */
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  /** Relation to owner user */
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  /** Relation to property photos */
  @OneToMany(() => PropertyPhoto, (photo) => photo.property)
  photos!: PropertyPhoto[];
}
