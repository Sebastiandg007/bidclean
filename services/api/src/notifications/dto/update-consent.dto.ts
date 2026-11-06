import { IsBoolean } from 'class-validator';

/** Body for `PATCH /notifications/devices/:playerId/consent`. */
export class UpdateConsentDto {
  /** New per-device consent value. */
  @IsBoolean()
  consentGranted!: boolean;
}
