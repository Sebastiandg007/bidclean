import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

import { DisputeResolution } from '../dispute.types';

/**
 * Body for `POST /disputes/:id/resolve` (resolver only).
 *
 * `{ resolution, refundCents? }`. `refundCents` is REQUIRED for `PARTIAL` (re-validated at the
 * service layer) and is the REQUESTED amount only — Spec 9 ceilings the applied amount. dispute-system
 * never computes the final amount.
 */
export class ResolveDisputeDto {
  @IsEnum(DisputeResolution)
  readonly resolution!: DisputeResolution;

  @IsOptional()
  @IsInt()
  @Min(0)
  readonly refundCents?: number;
}
