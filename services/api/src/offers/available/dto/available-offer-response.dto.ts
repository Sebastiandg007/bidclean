import { Expose, Type } from 'class-transformer';

/**
 * Property snapshot embedded in the available offer response.
 * Contains only public-facing property information (no street, postal code, or exact location).
 */
export class PropertySnapshotDto {
  @Expose()
  name!: string;

  @Expose()
  type!: string;

  @Expose()
  city!: string;

  @Expose()
  coverPhotoUrl!: string | null;
}

/**
 * Price breakdown from the Cleaner's perspective.
 * All monetary values are integers in the smallest currency unit (cents).
 */
export class CleanerPriceBreakdownDto {
  /** Price offered by the Host (cents) */
  @Expose()
  offeredPriceCents!: number;

  /** Platform commission deducted from Cleaner (cents) */
  @Expose()
  commissionCents!: number;

  /** Net payout to the Cleaner (cents) — offeredPrice - commission */
  @Expose()
  payoutCents!: number;

  /** ISO 4217 currency code (e.g., USD, COP, EUR) */
  @Expose()
  currency!: string;
}

/**
 * Approximate public location for an offer.
 * This is a stable city-level jittered point — NOT the exact property coordinates.
 */
export class PublicLocationDto {
  @Expose()
  lat!: number;

  @Expose()
  lng!: number;
}

/**
 * Single available offer response DTO.
 *
 * Represents an offer visible to the authenticated Cleaner.
 * Privacy-safe: no street address, postal code, or exact property location.
 */
export class AvailableOfferDto {
  @Expose()
  offerId!: string;

  @Expose()
  @Type(() => PropertySnapshotDto)
  propertySnapshot!: PropertySnapshotDto;

  @Expose()
  serviceType!: string;

  @Expose()
  description!: string | null;

  /** Scheduled service date/time in ISO 8601 (UTC) */
  @Expose()
  scheduledAt!: string;

  /** IANA timezone of the service location (for display conversion) */
  @Expose()
  timezone!: string;

  @Expose()
  estimatedDurationMinutes!: number;

  @Expose()
  @Type(() => CleanerPriceBreakdownDto)
  priceBreakdown!: CleanerPriceBreakdownDto;

  /** Distance from Cleaner's work zone center in meters */
  @Expose()
  distanceMeters!: number;

  /** When the offer was published (ISO 8601) */
  @Expose()
  publishedAt!: string;

  /** Whether the offer is scheduled within 2 hours (time-sensitive) */
  @Expose()
  isUrgent!: boolean;

  @Expose()
  @Type(() => PublicLocationDto)
  publicLocation!: PublicLocationDto;
}

/**
 * Pagination metadata for available offers response.
 */
export class AvailableOffersPaginationDto {
  @Expose()
  page!: number;

  @Expose()
  limit!: number;

  @Expose()
  total!: number;

  @Expose()
  totalPages!: number;
}

/**
 * Paginated available offers response.
 *
 * Used by GET /offers/available endpoint.
 */
export class AvailableOffersResponseDto {
  @Expose()
  @Type(() => AvailableOfferDto)
  items!: AvailableOfferDto[];

  @Expose()
  @Type(() => AvailableOffersPaginationDto)
  pagination!: AvailableOffersPaginationDto;
}

/**
 * Snapshot response for full reconciliation.
 *
 * Used by GET /offers/available/snapshot endpoint.
 * Returns ALL available offers without pagination (unpaginated full set).
 * Rate-limited: max 1 request per 30 seconds per Cleaner.
 */
export class AvailableOffersSnapshotResponseDto {
  @Expose()
  @Type(() => AvailableOfferDto)
  offers!: AvailableOfferDto[];

  /** Server timestamp of the snapshot (ISO 8601, UTC) */
  @Expose()
  syncedAt!: string;
}
