import { IsString, IsNotEmpty } from 'class-validator';

/**
 * DTO for requesting a biometric challenge.
 * The device sends its identifier to receive a one-time nonce.
 */
export class BiometricChallengeDto {
  @IsString()
  @IsNotEmpty()
  readonly deviceId!: string;
}
