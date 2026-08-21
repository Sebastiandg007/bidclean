import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';

/**
 * DTO for updating common profile fields.
 * Used by PATCH /profile/me.
 * Only display_name and phone_number are updatable via this endpoint.
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'profile.error.invalid_display_name' })
  @MaxLength(100)
  displayName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{1,14}$/, { message: 'profile.error.invalid_phone' })
  phoneNumber?: string | null;
}
