import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * DTO for creating/updating the Cleaner onboarding profile.
 */
export class CleanerProfileDto {
  /** Display name shown to Hosts */
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  readonly displayName!: string;

  /** Work zone center latitude */
  @IsOptional()
  @IsNumber()
  readonly workZoneLat?: number;

  /** Work zone center longitude */
  @IsOptional()
  @IsNumber()
  readonly workZoneLng?: number;

  /** Work zone radius in kilometers */
  @IsOptional()
  @IsNumber()
  readonly workZoneRadiusKm?: number;

  /** Availability schedule (days/hours as JSON) */
  @IsOptional()
  @IsObject()
  readonly availability?: Record<string, unknown>;

  /** Cleaning specialties (e.g., Airbnb, offices, homes) */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  readonly specialties?: string[];
}
