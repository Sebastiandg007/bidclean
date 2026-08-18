import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * DTO for creating/updating the Host onboarding profile.
 */
export class HostProfileDto {
  /** Display name shown to Cleaners (pre-filled from registration) */
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  readonly displayName!: string;

  /** Whether the Host operates as a business */
  @IsBoolean()
  @IsOptional()
  readonly isBusiness?: boolean;

  /** Business name (required if isBusiness is true) */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  readonly businessName?: string;

  /** Whether a payment method has been added (Stripe reference) */
  @IsBoolean()
  @IsOptional()
  readonly paymentMethodAdded?: boolean;
}
