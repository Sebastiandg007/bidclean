import {
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/** "HH:MM" or "HH:MM:SS" 24h time. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

/** Body for `PUT /notifications/preferences` (categories + quiet-hours window + language). */
export class UpdatePreferencesDto {
  /** `{ [category]: false }` overrides; absent category defers to metadata defaultEnabled. */
  @IsOptional()
  @IsObject()
  categoryOptOut?: Record<string, boolean>;

  /** Local quiet-hours start (null/absent disables). */
  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'quietHoursStart must be HH:MM or HH:MM:SS' })
  quietHoursStart?: string;

  /** Local quiet-hours end. */
  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'quietHoursEnd must be HH:MM or HH:MM:SS' })
  quietHoursEnd?: string;

  /** IANA timezone for the window. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  quietHoursTimezone?: string;

  /** BCP 47 language override. */
  @IsOptional()
  @IsString()
  @MaxLength(35)
  language?: string;
}
