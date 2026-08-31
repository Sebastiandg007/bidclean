import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { RateSide, SubscriberTier } from '../commission.types';
import { BPS_MAX, SUPPORTED_COUNTRIES } from '../commission.constants';

/**
 * Payload to update a commission rule's mutable fields. All fields optional; only
 * provided fields are changed. A null-able scope cannot be cleared to ANY via this DTO
 * (v1); create a new rule for a different scope.
 */
export class UpdateRuleDto {
  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_COUNTRIES)
  country?: string;

  @IsOptional()
  @IsIn([SubscriberTier.FREE, SubscriberTier.PRO])
  subscriberTier?: SubscriberTier;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  serviceType?: string;

  @IsOptional()
  @IsIn([RateSide.HOST, RateSide.CLEANER])
  appliesTo?: RateSide;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(BPS_MAX)
  rateBps?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string;

  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string;
}
