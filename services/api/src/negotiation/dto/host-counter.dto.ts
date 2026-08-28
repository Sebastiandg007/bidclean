import { IsInt, IsPositive } from 'class-validator';

/**
 * Host counter-back DTO (Host or Cleaner countering a proposal with a new price).
 *
 * The proposed price is validated for positivity here; deviation-bound validation
 * (against the immutable Base Price) is performed in the service layer.
 */
export class HostCounterDto {
  /** Counter-back price in cents — must be a positive integer */
  @IsInt()
  @IsPositive()
  proposedPriceCents!: number;
}
