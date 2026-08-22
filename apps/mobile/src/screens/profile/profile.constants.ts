/**
 * Constants for the profile screens module.
 * All configurable values derive from environment variables at build time.
 * No hardcoded business rules — use env-based configuration.
 */

// TODO: Wire to actual environment config in task 28+

import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra ?? {};

/** Profile photo constraints (from env) */
export const PROFILE_PHOTO = {
  MAX_SIZE_MB: Number(extra.PROFILE_PHOTO_MAX_SIZE_MB) || 5,
  MAX_DIMENSION_PX: Number(extra.PROFILE_PHOTO_MAX_DIMENSION_PX) || 1024,
  URL_EXPIRY_SECONDS: Number(extra.PROFILE_PHOTO_URL_EXPIRY_SECONDS) || 3600,
  UPLOAD_TIMEOUT_MS: Number(extra.PROFILE_UPLOAD_TIMEOUT_MS) || 30000,
} as const;

/** Portfolio constraints (from env) */
export const PORTFOLIO = {
  MAX_PHOTOS: Number(extra.PROFILE_MAX_PORTFOLIO_PHOTOS) || 20,
} as const;

/** Validation limits (from env) */
export const VALIDATION = {
  NAME_MAX_LENGTH: Number(extra.PROFILE_NAME_MAX_LENGTH) || 100,
  BIO_MAX_LENGTH: Number(extra.PROFILE_BIO_MAX_LENGTH) || 500,
} as const;

/** Work zone configuration (from env with defaults) */
export const WORK_ZONE = {
  DEFAULT_RADIUS_KM: Number(extra.PROFILE_WORK_ZONE_DEFAULT_RADIUS_KM) || 10,
  MIN_RADIUS_KM: Number(extra.PROFILE_WORK_ZONE_MIN_RADIUS_KM) || 1,
  MAX_RADIUS_KM: Number(extra.PROFILE_WORK_ZONE_MAX_RADIUS_KM) || 50,
} as const;

/** Default time values for availability scheduler */
export const AVAILABILITY_DEFAULTS = {
  START_TIME: '08:00',
  END_TIME: '18:00',
} as const;

/** Days of the week for availability scheduler */
export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

/** Predefined cleaning specialties available for selection */
export const PREDEFINED_SPECIALTIES = [
  'deep_cleaning',
  'regular_cleaning',
  'move_in_out',
  'post_construction',
  'office_cleaning',
  'carpet_cleaning',
  'window_cleaning',
  'laundry',
  'organizing',
  'eco_friendly',
] as const;

/** Supported image MIME types for upload */
export const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/** Profile screen route names */
export const PROFILE_ROUTES = {
  PROFILE: 'profile',
  EDIT_PROFILE: 'profile/edit',
  SETTINGS: 'profile/settings',
  ACCOUNT: 'profile/account',
  PORTFOLIO_GALLERY: 'profile/portfolio',
  PUBLIC_PROFILE: 'profile/public',
} as const;

/** i18n key prefix for profile module */
export const I18N_PREFIX = 'profile' as const;
