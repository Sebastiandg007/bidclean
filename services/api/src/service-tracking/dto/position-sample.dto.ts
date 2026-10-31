import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * Body for `POST /service-sessions/:id/position` (Option A — the backend is on the path).
 *
 * `{ lat, lng, accuracy, heading?, at }`. Coordinates are client telemetry, not proof of physical
 * presence; the server rate-limits, gates eligibility (accuracy/staleness/clock-skew), runs the
 * geofence, transitions if arrived, then re-publishes to the Host. `at` is epoch milliseconds.
 */
export class PositionSampleDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  readonly lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  readonly lng!: number;

  /** Reported horizontal accuracy in metres (eligibility gate only; never a radius correction). */
  @IsNumber()
  @Min(0)
  readonly accuracy!: number;

  /** Optional heading in degrees (rendered by the Host; not used for the geofence). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  readonly heading?: number;

  /** Client capture time in epoch milliseconds (eligibility gate: age + clock-skew). */
  @IsInt()
  @Min(0)
  readonly at!: number;
}
