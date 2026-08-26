import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Publish offer DTO.
 *
 * Contains optional flags for the publish action.
 * Validates the favoritesFirst boolean flag.
 */
export class PublishOfferDto {
  /** Whether to deliver the offer to favorite Cleaners first (default: false) */
  @IsOptional()
  @IsBoolean()
  favoritesFirst?: boolean = false;
}
