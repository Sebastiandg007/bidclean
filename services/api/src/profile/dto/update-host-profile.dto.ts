import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * DTO for updating host-specific profile fields.
 * Used by PATCH /profile/me/host (requires Host role).
 */
export class UpdateHostProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  businessName?: string;
}
