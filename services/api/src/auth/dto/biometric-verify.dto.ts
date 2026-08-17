import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * DTO for biometric verification.
 * Contains the signed challenge from the device.
 */
export class BiometricVerifyDto {
  /** Device identifier that registered the biometric credential */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  readonly deviceId!: string;

  /** The challenge nonce that was signed by the device */
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  readonly challenge!: string;

  /** Cryptographic signature of the challenge, signed with the device's private key */
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  readonly signature!: string;
}
