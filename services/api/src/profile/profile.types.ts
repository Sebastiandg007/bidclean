/**
 * Profile module type definitions.
 */

/** Days of the week for availability scheduling */
export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

/** A single day's availability slot */
export interface DayAvailability {
  readonly enabled: boolean;
  readonly start: string | null;
  readonly end: string | null;
}

/** Weekly availability schedule stored as JSONB in cleaner_profiles */
export type WeeklyAvailability = Record<DayOfWeek, DayAvailability>;

/** Common profile fields (from profile_details table) */
export interface CommonProfileFields {
  readonly displayName: string;
  readonly phoneNumber: string | null;
  readonly photoStorageKey: string | null;
  readonly bio: string | null;
}

/** Host-specific fields (from host_profiles table, owned by user-roles) */
export interface HostProfileFields {
  readonly businessName: string | null;
}

/** Cleaner-specific fields (from cleaner_profiles table, owned by user-roles) */
export interface CleanerProfileFields {
  readonly specialties: string[];
  readonly workZoneCenter: { lat: number; lng: number } | null;
  readonly workZoneRadiusKm: number | null;
  readonly workZoneLabel: string | null;
  readonly availability: WeeklyAvailability | null;
}

/** Full private profile returned by GET /profile/me */
export interface PrivateProfile {
  readonly id: string;
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly phoneNumber: string | null;
  readonly photoUrl: string | null;
  readonly bio: string | null;
  readonly activeRole: string | null;
  readonly roles: string[];
  readonly hostProfile: HostProfileFields | null;
  readonly cleanerProfile: CleanerProfileFields | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Public profile returned by GET /profile/:userId (dedicated SELECT) */
export interface PublicProfile {
  readonly userId: string;
  readonly displayName: string;
  readonly photoUrl: string | null;
  readonly bio: string | null;
  readonly memberSince: Date;
  readonly specialties: string[] | null;
  readonly workZoneLabel: string | null;
  readonly isKycVerified: boolean;
}

/** Profile completeness result */
export interface ProfileCompleteness {
  readonly percentage: number;
  readonly role: string;
  readonly fields: CompletenessField[];
}

/** Individual completeness field status */
export interface CompletenessField {
  readonly name: string;
  readonly completed: boolean;
  readonly weight: number;
}

/** Signed URL response for photo access */
export interface SignedPhotoUrl {
  readonly url: string;
  readonly expiresAt: Date;
}

/** Raw row returned by findPublicProfile dedicated SELECT query */
export interface PublicProfileRow {
  readonly userId: string;
  readonly displayName: string;
  readonly photoStorageKey: string | null;
  readonly bio: string | null;
  readonly memberSince: Date;
  readonly specialties: string[] | null;
  readonly isKycVerified: boolean;
}

/** Account deletion job payload */
export interface DeletionJobPayload {
  readonly userId: string;
  readonly keycloakId: string;
  readonly idempotencyKey: string;
  readonly requestedAt: Date;
}

/** Keycloak email webhook event payload */
export interface KeycloakEmailEvent {
  readonly userId: string;
  readonly type: string;
  readonly details: {
    readonly updated_email: string;
  };
}
