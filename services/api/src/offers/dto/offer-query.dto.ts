import { IsOptional, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { OfferState } from '../offers.types';
import {
  OFFER_LIST_DEFAULT_PAGE_SIZE,
  OFFER_LIST_MAX_PAGE_SIZE,
} from '../offers.constants';

/**
 * Offer query DTO.
 *
 * Pagination and filtering parameters for the offer list endpoint.
 * All query params arrive as strings — @Type(() => Number) handles transform.
 */
export class OfferQueryDto {
  /** Filter offers by lifecycle state */
  @IsOptional()
  @IsEnum(OfferState)
  state?: OfferState;

  /** Page number (1-indexed, default: 1) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  /** Items per page (default: 20, max: 100) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(OFFER_LIST_MAX_PAGE_SIZE)
  pageSize: number = OFFER_LIST_DEFAULT_PAGE_SIZE;
}
