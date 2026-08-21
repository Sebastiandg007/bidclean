import { IsOptional, IsString, MaxLength, Matches } from 'class-validator';

/**
 * DTO for updating common profile fields.
 * Used by PATCH /profile/me.
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{1,14}$/, { message: 'profile.error.invalid_phone' })
  phoneNumber?: string;
}
