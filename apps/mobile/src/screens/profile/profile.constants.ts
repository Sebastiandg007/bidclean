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
