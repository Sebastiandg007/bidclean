import { IsInt, IsOptional, IsPositive } from 'class-validator';

/**
 * Refund request body. Omit `amountCents` for a full refund of the remaining amount;
 * provide a positive integer for a partial refund (business ceilings enforced in the
 * service).
 */
export class RefundDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  amountCents?: number;
}
