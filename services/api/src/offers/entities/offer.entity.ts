import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Check,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { Property } from '../../properties/entities/property.entity';
import { OfferStateTransition } from './offer-state-transition.entity';
import { OfferDelivery } from './offer-delivery.entity';

/**
 * Offer entity.
 *
 * Maps to the `offers` database table.
 * Represents a cleaning service offer published by a Host and delivered to nearby Cleaners.
 * Contains lifecycle state, pricing (cents), property snapshot,
 * delivery configuration, and radius expansion tracking.
 *
 * All monetary values are INTEGER (cents) — integer-only arithmetic, no floating-point.
 * Commission rates are stored in basis points (1 bp = 0.01%).
 */
@Entity('offers')
@Check('chk_state', `"state" IN ('DRAFT', 'PUBLISHED', 'ACTIVE', 'MATCHED', 'COMPLETED', 'CANCELLED', 'EXPIRED')`)
@Check('chk_service_type', `"service_type" IN ('standard', 'deep', 'move_in_out', 'post_construction', 'post_event', 'recurring')`)
@Check('chk_price_positive', `"offered_price_cents" > 0`)
@Check('chk_duration_bounds', `"estimated_duration_minutes" > 0`)
@Check('chk_host_total', `"host_total_cents" = "offered_price_cents" + "host_service_fee_cents"`)
@Check('chk_cleaner_payout', `"cleaner_payout_cents" = "offered_price_cents" - "cleaner_commission_cents"`)
@Index('idx_offers_host', ['hostId'])
@Index('idx_offers_state', ['state'])
export class Offer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Host user who created this offer — FK with RESTRICT (prevents deletion while offers exist) */
  @Column({ name: 'host_id', type: 'uuid' })
  hostId!: string;

  /** Property where the cleaning service will be performed — FK with RESTRICT */
  @Column({ name: 'property_id', type: 'uuid' })
  propertyId!: string;

  /** Type of cleaning service: standard, deep, move_in_out, post_construction, post_event, recurring */
  @Column({ name: 'service_type', type: 'varchar', length: 30 })
  serviceType!: string;

  /** Optional free-text description with special instructions or context */
  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** When the cleaning is scheduled to start (absolute UTC timestamp) */
  @Column({ name: 'scheduled_at', type: 'timestamptz' })
  scheduledAt!: Date;

  /** IANA timezone identifier for display purposes (e.g., 'America/Bogota') */
  @Column({ type: 'varchar', length: 64 })
  timezone!: string;

  /** Estimated duration of the cleaning service in minutes */
  @Column({ name: 'estimated_duration_minutes', type: 'integer' })
  estimatedDurationMinutes!: number;

  /** Price offered to the Cleaner in cents (integer arithmetic only) */
  @Column({ name: 'offered_price_cents', type: 'integer' })
  offeredPriceCents!: number;

  /** ISO 4217 currency code (e.g., 'USD', 'COP', 'EUR') */
  @Column({ type: 'char', length: 3 })
  currency!: string;

  /** Host service fee in cents (added to host total) */
  @Column({ name: 'host_service_fee_cents', type: 'integer' })
  hostServiceFeeCents!: number;

  /** Total amount charged to the Host in cents (offered_price_cents + host_service_fee_cents) */
  @Column({ name: 'host_total_cents', type: 'integer' })
  hostTotalCents!: number;

  /** Platform commission deducted from Cleaner payout in cents */
  @Column({ name: 'cleaner_commission_cents', type: 'integer' })
  cleanerCommissionCents!: number;

  /** Net payout to Cleaner in cents (offered_price_cents - cleaner_commission_cents) */
  @Column({ name: 'cleaner_payout_cents', type: 'integer' })
  cleanerPayoutCents!: number;

  /** Host service fee rate snapshot in basis points at time of creation (immutable) */
  @Column({ name: 'host_service_fee_rate_bps', type: 'integer' })
  hostServiceFeeRateBps!: number;

  /** Cleaner commission rate snapshot in basis points at time of creation (immutable) */
  @Column({ name: 'cleaner_commission_rate_bps', type: 'integer' })
  cleanerCommissionRateBps!: number;

  /** Denormalized property name at time of publish (immutable after persist) */
  @Column({ name: 'property_name_snapshot', type: 'varchar', length: 255, nullable: true })
  propertyNameSnapshot!: string | null;

  /** Denormalized property type at time of publish (immutable after persist) */
  @Column({ name: 'property_type_snapshot', type: 'varchar', length: 30, nullable: true })
  propertyTypeSnapshot!: string | null;

  /** Denormalized property city at time of publish (immutable after persist) */
  @Column({ name: 'property_city_snapshot', type: 'varchar', length: 100, nullable: true })
  propertyCitySnapshot!: string | null;

  /** Denormalized property cover photo URL at time of publish (immutable after persist) */
  @Column({ name: 'property_cover_photo_snapshot', type: 'text', nullable: true })
  propertyCoverPhotoSnapshot!: string | null;

  /** Current lifecycle state of the offer (state machine enforced) */
  @Column({ type: 'varchar', length: 20, default: 'DRAFT' })
  state!: string;

  /** Whether to deliver to Favorite Cleaners first before expanding to PRO/FREE tiers */
  @Column({ name: 'favorites_first', type: 'boolean', default: false })
  favoritesFirst!: boolean;

  /** Current search radius in meters for progressive Cleaner discovery */
  @Column({ name: 'current_radius_meters', type: 'integer', default: 0 })
  currentRadiusMeters!: number;

  /** How many radius expansion steps have been executed so far */
  @Column({ name: 'expansion_step_count', type: 'integer', default: 0 })
  expansionStepCount!: number;

  /** Client-generated idempotency key to prevent duplicate offer creation on retry */
  @Column({ name: 'idempotency_key', type: 'varchar', length: 255, nullable: true })
  idempotencyKey!: string | null;

  /** When the offer was published (DRAFT → PUBLISHED transition) */
  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  /** When the offer expired (no Cleaner accepted within time/radius limits) */
  @Column({ name: 'expired_at', type: 'timestamptz', nullable: true })
  expiredAt!: Date | null;

  /** When the offer was cancelled by the Host */
  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  /** When a Cleaner was matched to this offer */
  @Column({ name: 'matched_at', type: 'timestamptz', nullable: true })
  matchedAt!: Date | null;

  /** When the cleaning service was marked as completed */
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  /** Relation to the Host user who created this offer */
  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'host_id' })
  host!: User;

  /** Relation to the Property where cleaning will be performed */
  @ManyToOne(() => Property, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'property_id' })
  property!: Property;

  /** State transition audit trail for this offer */
  @OneToMany(() => OfferStateTransition, (transition) => transition.offer)
  stateTransitions!: OfferStateTransition[];

  /** Delivery records tracking which Cleaners received this offer */
  @OneToMany(() => OfferDelivery, (delivery) => delivery.offer)
  deliveries!: OfferDelivery[];
}
