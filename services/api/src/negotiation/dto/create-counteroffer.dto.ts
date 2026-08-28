import { IsInt, IsPositive } from 'class-validator';

/**
 * Create counteroffer DTO (Cleaner submitting a counteroffer).
 *
 * The proposed price is validated for positivity here; deviation-bound validation
 * (against the immutable Base Price) is performed in the service layer.
 */
export class CreateCounterofferDto {
  /** Proposed price in cents — must be a positive integer */
  @IsInt()
  @IsPositive()
  proposedPriceCents!: number;
}
