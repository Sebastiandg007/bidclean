import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Body for `POST /notifications/devices` (register/upsert a device). */
export class RegisterDeviceDto {
  /** The OneSignal player id (per-device subscription target). */
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  onesignalPlayerId!: string;

  /** Device platform. */
  @IsIn(['IOS', 'ANDROID', 'WEB'])
  platform!: string;

  /** Per-device consent (reflects the OS permission state). */
  @IsBoolean()
  consentGranted!: boolean;

  /**
   * Optional client-declared user id. When present it MUST equal the JWT subject; a mismatch is
   * rejected with 403 and mutates nothing (Property 7).
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  userId?: string;
}
