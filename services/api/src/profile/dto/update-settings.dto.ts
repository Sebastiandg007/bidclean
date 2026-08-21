import { IsOptional, IsString, IsBoolean, IsIn } from 'class-validator';

/**
 * DTO for updating user settings.
 * Used by PATCH /profile/me/settings.
 */
export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  @IsIn(['dark', 'light', 'system'])
  theme?: string;

  @IsOptional()
  @IsBoolean()
  isPushEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isEmailNotificationsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isSoundsEnabled?: boolean;
}
