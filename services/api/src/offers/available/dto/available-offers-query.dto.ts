import {
  IsOptional,
  IsEnum,
  IsInt,
  IsArray,
  IsDateString,
  Min,
  Max,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ServiceType } from '../../offers.types';

/**
 * Sort options for available offers.
 * Determines the ordering of results returned by the endpoint.
 */
export enum AvailableOffersSortOption {
  DISTANCE_ASC = 'distance_asc',
  PRICE_DESC = 'price_desc',
  SCHEDULED_ASC = 'scheduled_asc',
  PUBLISHED_DESC = 'published_desc',
}

/** Default page size for available offers queries */
const AVAILABLE_OFFERS_DEFAULT_PAGE_SIZE = 20;

/** Maximum page size for available offers queries */
const AVAILABLE_OFFERS_MAX_PAGE_SIZE = 50;

/**
 * Available offers query DTO.
 *
 * Server-side filter and pagination parameters for the Cleaner's
 * available offers endpoint. All filters are optional and additive
 * (each applied only when provided).
 *
 * Query params arrive as strings — @Type(() => Number) handles transform.
 */
export class AvailableOffersQueryDto {
  /**
   * Filter by service types (comma-separated in query string).
   * Only offers matching one of the specified types are returned.
   */
  @IsOptional()
  @IsArray()
  @IsEnum(ServiceType, { each: true })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  serviceType?: ServiceType[];

  /** Minimum Cleaner payout in cents (inclusive) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPriceCents?: number;

  /** Maximum Cleaner payout in cents (inclusive) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPriceCents?: number;

  /**
   * Maximum distance from Cleaner's work zone center in meters.
   * This is a presentation-only filter — it does NOT affect offer delivery eligibility.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxDistanceMeters?: number;

  /** Filter offers scheduled before this timestamp (ISO 8601, inclusive) */
  @IsOptional()
  @IsDateString()
  scheduledBefore?: string;

  /** Filter offers scheduled after this timestamp (ISO 8601, inclusive) */
  @IsOptional()
  @IsDateString()
  scheduledAfter?: string;

  /** Sort order for results (default: distance_asc) */
  @IsOptional()
  @IsEnum(AvailableOffersSortOption)
  sort: AvailableOffersSortOption = AvailableOffersSortOption.DISTANCE_ASC;

  /** Page number (1-indexed, default: 1) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  /** Items per page (default: 20, max: 50) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(AVAILABLE_OFFERS_MAX_PAGE_SIZE)
  limit: number = AVAILABLE_OFFERS_DEFAULT_PAGE_SIZE;
}
