import { Expose, Type } from 'class-transformer';
import { OfferState, ServiceType } from '../offers.types';

/**
 * State transition entry in the offer response.
 * Represents a single lifecycle transition with timestamp and actor.
 */
export class StateTransitionDto {
  @Expose()
  id!: string;

  @Expose()
  fromState!: string | null;

  @Expose()
  toState!: string;

  @Expose()
  triggeredBy!: string;

  @Expose()
  metadata!: Record<string, unknown> | null;

  @Expose()
  createdAt!: Date;
}

/**
 * Price breakdown embedded in the offer response.
 * Shows commission split from the Host perspective (included in full offer response).
 */
export class OfferPriceBreakdownDto {
  /** Price offered to Cleaner in cents */
  @Expose()
  offeredPriceCents!: number;

  /** Host service fee in cents */
  @Expose()
  hostServiceFeeCents!: number;

  /** Total charged to Host in cents (offeredPrice + hostFee) */
  @Expose()
  hostTotalCents!: number;

  /** Cleaner commission deducted in cents */
  @Expose()
  cleanerCommissionCents!: number;

  /** Cleaner net payout in cents (offeredPrice - commission) */
  @Expose()
  cleanerPayoutCents!: number;

  /** Host fee rate in basis points at time of creation */
  @Expose()
  hostServiceFeeRateBps!: number;

  /** Cleaner commission rate in basis points at time of creation */
  @Expose()
  cleanerCommissionRateBps!: number;

  /** ISO 4217 currency code */
  @Expose()
  currency!: string;
}

/**
 * Full offer response DTO.
 *
 * Returns the complete offer with price breakdown and state transition history.
 * Used by GET /offers/:id endpoint.
 */
export class OfferResponseDto {
  @Expose()
  id!: string;

  @Expose()
  hostId!: string;

  @Expose()
  propertyId!: string;

  @Expose()
  serviceType!: ServiceType;

  @Expose()
  description!: string | null;

  @Expose()
  scheduledAt!: Date;

  @Expose()
  timezone!: string;

  @Expose()
  estimatedDurationMinutes!: number;

  @Expose()
  state!: OfferState;

  /** Whether favorites-first delivery is enabled */
  @Expose()
  favoritesFirst!: boolean;

  /** Current search radius in meters */
  @Expose()
  currentRadiusMeters!: number;

  /** Number of expansion steps completed */
  @Expose()
  expansionStepCount!: number;

  /** Property snapshot at time of publish */
  @Expose()
  propertyNameSnapshot!: string | null;

  @Expose()
  propertyTypeSnapshot!: string | null;

  @Expose()
  propertyCitySnapshot!: string | null;

  @Expose()
  propertyCoverPhotoSnapshot!: string | null;

  /** Full price breakdown */
  @Expose()
  @Type(() => OfferPriceBreakdownDto)
  priceBreakdown!: OfferPriceBreakdownDto;

  /** State transition history (chronological) */
  @Expose()
  @Type(() => StateTransitionDto)
  stateHistory!: StateTransitionDto[];

  /** Lifecycle timestamps */
  @Expose()
  publishedAt!: Date | null;

  @Expose()
  expiredAt!: Date | null;

  @Expose()
  cancelledAt!: Date | null;

  @Expose()
  matchedAt!: Date | null;

  @Expose()
  completedAt!: Date | null;

  @Expose()
  createdAt!: Date;

  @Expose()
  updatedAt!: Date;
}

/**
 * Price breakdown response DTO.
 *
 * Role-based view of the commission split:
 * - Host view: offeredPrice + serviceFee = total (what the Host pays)
 * - Cleaner view: offeredPrice - commission = payout (what the Cleaner receives)
 *
 * Used by GET /offers/:id/price-breakdown endpoint.
 */
export class PriceBreakdownResponseDto {
  /** Role perspective for this breakdown ('host' or 'cleaner') */
  @Expose()
  viewRole!: 'host' | 'cleaner';

  /** ISO 4217 currency code */
  @Expose()
  currency!: string;

  /** Price offered by the Host in cents */
  @Expose()
  offeredPriceCents!: number;

  /**
   * Host view fields.
   * Only present when viewRole = 'host'.
   */

  /** Host service fee in cents (null for Cleaner view) */
  @Expose()
  hostServiceFeeCents!: number | null;

  /** Total charged to Host in cents (null for Cleaner view) */
  @Expose()
  hostTotalCents!: number | null;

  /** Host fee rate in basis points (null for Cleaner view) */
  @Expose()
  hostServiceFeeRateBps!: number | null;

  /**
   * Cleaner view fields.
   * Only present when viewRole = 'cleaner'.
   */

  /** Platform commission deducted from Cleaner in cents (null for Host view) */
  @Expose()
  cleanerCommissionCents!: number | null;

  /** Cleaner net payout in cents (null for Host view) */
  @Expose()
  cleanerPayoutCents!: number | null;

  /** Cleaner commission rate in basis points (null for Host view) */
  @Expose()
  cleanerCommissionRateBps!: number | null;
}
