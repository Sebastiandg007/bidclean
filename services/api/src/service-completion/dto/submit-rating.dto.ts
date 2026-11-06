import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Body for `POST /service-completions/:id/ratings`.
 *
 * `{ stars, comment? }`. `stars` bounds are re-validated at the service layer against the configured
 * min/max (this DTO enforces the hard 1..5 DDL floor/ceiling). `comment` is user content — length
 * bounded here, validated/escaped downstream, never executed.
 */
export class SubmitRatingDto {
  @IsInt()
  @Min(1)
  @Max(5)
  readonly stars!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  readonly comment?: string;
}
