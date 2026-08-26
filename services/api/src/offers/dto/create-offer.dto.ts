import {
  IsUUID,
  IsEnum,
  IsInt,
  IsPositive,
  IsDateString,
  IsString,
  IsOptional,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { ServiceType } from '../offers.types';
import {
  OFFER_MIN_DURATION_MINUTES,
  OFFER_MAX_DURATION_MINUTES,
} from '../offers.constants';

/**
 * Create offer DTO.
 *
 * Validated with class-validator decorators.
 * All monetary values are integers (cents).
 * Requires: propertyId (UUID), serviceType, offeredPriceCents (positive int),
 * scheduledAt (ISO date string), estimatedDurationMinutes (30–480), timezone, currency.
 * Optional: description, idempotencyKey.
 */
export class CreateOfferDto {
  /** UUID of the property where the cleaning will be performed */
  @IsUUID('4')
  propertyId!: string;

  /** Type of cleaning service to perform */
  @IsEnum(ServiceType)
  serviceType!: ServiceType;

  /** Offered price in cents — must be a positive integer */
  @IsInt()
  @IsPositive()
  offeredPriceCents!: number;

  /** ISO 8601 date string for when the cleaning is scheduled (must be in the future) */
  @IsDateString()
  scheduledAt!: string;

  /** IANA timezone identifier (e.g., 'America/Bogota', 'America/New_York') */
  @IsString()
  @MaxLength(64)
  timezone!: string;

  /** Estimated duration of the cleaning service in minutes (30–480) */
  @IsInt()
  @Min(OFFER_MIN_DURATION_MINUTES)
  @Max(OFFER_MAX_DURATION_MINUTES)
  estimatedDurationMinutes!: number;

  /** ISO 4217 currency code (e.g., 'USD', 'COP', 'EUR') */
  @IsString()
  @MaxLength(3)
  currency!: string;

  /** Optional description with special instructions for the Cleaner */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /** Client-generated idempotency key to prevent duplicate offers on retry */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  idempotencyKey?: string;
}
