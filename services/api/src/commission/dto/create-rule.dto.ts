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
 * Payload to create a commission rule (one side).
 *
 * Scope fields are optional; omitting one means ANY on that dimension. `rateBps` is bounded
 * to the technical [0, 10000] here; the business-policy cap is enforced in the service layer.
 */
export class CreateRuleDto {
  /** ISO 3166-1 alpha-2 country, or omit for ANY */
  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_COUNTRIES)
  country?: string;

  /** Subscriber tier scope (FREE|PRO), or omit for ANY */
  @IsOptional()
  @IsIn([SubscriberTier.FREE, SubscriberTier.PRO])
  subscriberTier?: SubscriberTier;

  /** Service-type scope, or omit for ANY */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  serviceType?: string;

  /** The side this rule sets */
  @IsIn([RateSide.HOST, RateSide.CLEANER])
  appliesTo!: RateSide;

  /** Rate in basis points (technical bound; business cap enforced in the service) */
  @IsInt()
  @Min(0)
  @Max(BPS_MAX)
  rateBps!: number;

  /** Selection priority (higher wins after specificity) */
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  /** Inclusive window start (ISO 8601); may be in the future for scheduled changes */
  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string;

  /** Exclusive window end (ISO 8601), or omit for open-ended */
  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;

  /** Optional audit reason, persisted verbatim */
  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string;
}
