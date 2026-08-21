/**
 * Shared types for the profile screens module.
 * Defines profile data structures, API response shapes, and component props.
 */

// TODO: Implement full type definitions in task 28+

/** Active role determines which profile card is rendered */
export type ActiveRole = 'host' | 'cleaner';

/** Theme preference options */
export type ThemePreference = 'dark' | 'light' | 'system';

/** Profile completeness breakdown per field */
export interface CompletenessField {
  field: string;
  completed: boolean;
  weight: number;
}

/** Profile completeness response */
export interface ProfileCompleteness {
  percentage: number;
  breakdown: CompletenessField[];
}

/** Common profile fields (shared between Host and Cleaner) */
export interface CommonProfile {
  userId: string;
  displayName: string;
  email: string; // read-only, denormalized from Keycloak
  phoneNumber: string | null;
  photoUrl: string | null;
  memberSince: string;
}

/** Host-specific profile fields */
export interface HostProfile {
  businessName: string | null;
  propertiesCount: number;
  paymentMethodsCount: number;
  averageRating: number | null;
  completedServicesCount: number;
}

/** Cleaner-specific profile fields */
export interface CleanerProfile {
  specialties: string[];
  workZoneCenter: { lat: number; lng: number } | null;
  workZoneRadiusKm: number | null;
  workZoneLabel: string | null;
  availability: Record<string, unknown> | null;
  bio: string | null;
  portfolioCount: number;
  averageRating: number | null;
  completedServicesCount: number;
  kycBadge: boolean;
}

/** Full private profile (own profile view) */
export interface FullProfile {
  common: CommonProfile;
  host: HostProfile | null;
  cleaner: CleanerProfile | null;
  activeRole: ActiveRole;
  completeness: ProfileCompleteness;
}

/** Public profile (viewing another user) */
export interface PublicProfile {
  userId: string;
  displayName: string;
  photoUrl: string | null;
  memberSince: string;
  businessName?: string | null;
  bio?: string | null;
  specialties?: string[];
  workZoneLabel?: string | null;
  kycBadge?: boolean;
  averageRating?: number | null;
  completedServicesCount?: number;
}

/** User settings */
export interface UserSettings {
  language: string;
  theme: ThemePreference;
  pushNotifications: boolean;
  emailNotifications: boolean;
  inAppSounds: boolean;
}

/** Portfolio photo item */
export interface PortfolioPhoto {
  id: string;
  url: string;
  displayOrder: number;
  uploadedAt: string;
}

/** Profile screen navigation params */
export interface ProfileScreenParams {
  userId?: string; // if provided, shows public profile
}
