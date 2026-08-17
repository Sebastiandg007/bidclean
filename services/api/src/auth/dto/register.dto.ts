import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTO for user registration.
 * Validates input before passing to the auth service.
 */
export class RegisterDto {
  /** User's full name */
  @IsNotEmpty()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  readonly fullName!: string;

  /** Email address (must be valid format) */
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(255)
  readonly email!: string;

  /** Password (min 8 chars, 1 uppercase, 1 number, 1 special) */
  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/, {
    message:
      'Password must contain at least 1 uppercase letter, 1 number, and 1 special character',
  })
  readonly password!: string;

  /** Country code (ISO 3166-1 alpha-2, e.g., "CO", "US", "ES") */
  @IsNotEmpty()
  @IsString()
  @Matches(/^[A-Z]{2}$/, {
    message: 'Country must be a valid ISO 3166-1 alpha-2 code (2 uppercase letters)',
  })
  readonly country!: string;

  /** Preferred language (BCP 47, e.g., "en", "es", "fr") */
  @IsNotEmpty()
  @IsString()
  @Matches(/^[a-z]{2,3}(-[A-Z]{2})?$/, {
    message: 'Language must be a valid BCP 47 format (e.g., "en", "es", "fr", "pt-BR")',
  })
  readonly language!: string;
}
