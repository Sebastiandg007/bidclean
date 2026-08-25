import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Check,
  Unique,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { Offer } from './offer.entity';

/**
 * Offer delivery entity.
 *
 * Maps to the `offer_deliveries` table.
 * Tracks which Cleaners received which offers, via which channel,
 * at which tier and radius step. Used for:
 * - Excluding already-delivered Cleaners from expansion
 * - Sending cancellation notifications to delivered Cleaners
 * - Analytics on delivery success rates per tier/channel
 * - Stale-job detection via radius_step comparison
 */
@Entity('offer_deliveries')
@Unique('uq_offer_delivery', ['offerId', 'cleanerId'])
@Check('chk_tier', `"tier" IN ('FAVORITE', 'PRO', 'FREE')`)
@Check('chk_status', `"delivery_status" IN ('PENDING', 'SENT', 'FAILED')`)
@Check('chk_channel', `"delivery_channel" IS NULL OR "delivery_channel" IN ('WEBSOCKET', 'PUSH')`)
@Index('idx_offer_deliveries_offer', ['offerId'])
@Index('idx_offer_deliveries_cleaner', ['cleanerId'])
@Index('idx_offer_deliveries_offer_status', ['offerId', 'deliveryStatus'])
export class OfferDelivery {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Parent offer ID — FK with CASCADE (deliveries are meaningless without their offer) */
  @Column({ name: 'offer_id', type: 'uuid' })
  offerId!: string;

  /** Target Cleaner ID — SET NULL preserves delivery audit history when a Cleaner is deleted */
  @Column({ name: 'cleaner_id', type: 'uuid', nullable: true })
  cleanerId!: string | null;

  /** Delivery tier determines priority: FAVORITE → PRO → FREE */
  @Column({ type: 'varchar', length: 10 })
  tier!: string;

  /** Delivery lifecycle status: PENDING → SENT or FAILED */
  @Column({ name: 'delivery_status', type: 'varchar', length: 10, default: 'PENDING' })
  deliveryStatus!: string;

  /** Channel used for successful delivery (NULL while PENDING, set on SENT) */
  @Column({ name: 'delivery_channel', type: 'varchar', length: 20, nullable: true })
  deliveryChannel!: string | null;

  /** Reason for delivery failure (NULL unless status is FAILED) */
  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason!: string | null;

  /** Which radius expansion step generated this delivery (enables stale-job detection) */
  @Column({ name: 'radius_step', type: 'integer' })
  radiusStep!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  /** When the delivery was successfully sent to the Cleaner (NULL until SENT) */
  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;

  /** Relation to the parent offer */
  @ManyToOne(() => Offer, (offer) => offer.deliveries, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'offer_id' })
  offer!: Offer;

  /** Relation to the target Cleaner (nullable — preserved on user deletion) */
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'cleaner_id' })
  cleaner!: User | null;
}
