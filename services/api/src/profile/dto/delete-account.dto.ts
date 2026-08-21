import { IsString, IsNotEmpty } from 'class-validator';

/**
 * DTO for account deletion request.
 * Used by POST /profile/me/delete-account.
 * The confirmation word is validated against the configured env value.
 */
export class DeleteAccountDto {
  @IsString()
  @IsNotEmpty()
  confirmationWord!: string;
}
