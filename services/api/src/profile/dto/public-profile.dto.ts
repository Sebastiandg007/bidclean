/**
 * Response DTO for public profile views.
 * Only non-sensitive fields exposed via GET /profile/:userId.
 */
export class PublicProfileDto {
  readonly userId!: string;
  readonly displayName!: string;
  readonly photoUrl!: string | null;
  readonly bio!: string | null;
  readonly memberSince!: Date;
  readonly specialties!: string[] | null;
  readonly workZoneLabel!: string | null;
  readonly isKycVerified!: boolean;
}
