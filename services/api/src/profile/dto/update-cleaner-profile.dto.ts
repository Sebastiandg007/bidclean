import {
  IsOptional,
  IsString,
  IsArray,
  IsNumber,
  IsObject,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';
import { WeeklyAvailability } from '../profile.types';

/**
 * DTO for updating cleaner-specific profile fields.
 * Used by PATCH /profile/me/cleaner (requires Cleaner role).
 */
export class UpdateCleanerProfileDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  specialties?: string[];

  @IsOptional()
  @IsObject()
  workZoneCenter?: { lat: number; lng: number };

  @IsOptional()
  @IsNumber()
  workZoneRadiusKm?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  workZoneLabel?: string;

  @IsOptional()
  @IsObject()
  availability?: WeeklyAvailability;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;
}
