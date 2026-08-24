/**
 * Properties module constants.
 *
 * All configurable values for property management,
 * environment-dependent settings, and design tokens.
 */

import type { PropertyType, SupportedCountry } from './properties.types';

// ─── Environment-Derived Configuration ───────────────────────────────────────

/** Maximum number of photos per property */
export const PROPERTY_MAX_PHOTOS = Number(
  process.env.EXPO_PUBLIC_PROPERTY_MAX_PHOTOS ?? '10',
);

/** Maximum photo file size in megabytes */
export const PROPERTY_PHOTO_MAX_SIZE_MB = Number(
  process.env.EXPO_PUBLIC_PROPERTY_PHOTO_MAX_SIZE_MB ?? '5',
);

/** Maximum photo dimension in pixels (resized before upload) */
export const PROPERTY_PHOTO_MAX_DIMENSION_PX = Number(
  process.env.EXPO_PUBLIC_PROPERTY_PHOTO_MAX_DIMENSION_PX ?? '2048',
);

/** Photo upload timeout in milliseconds */
export const PROPERTY_UPLOAD_TIMEOUT_MS = Number(
  process.env.EXPO_PUBLIC_PROPERTY_UPLOAD_TIMEOUT_MS ?? '30000',
);

// ─── Validation Limits ───────────────────────────────────────────────────────

/** Maximum square meters allowed */
export const PROPERTY_MAX_SQM = Number(
  process.env.EXPO_PUBLIC_PROPERTY_MAX_SQM ?? '10000',
);

/** Maximum number of bedrooms */
export const PROPERTY_MAX_BEDROOMS = Number(
  process.env.EXPO_PUBLIC_PROPERTY_MAX_BEDROOMS ?? '50',
);

/** Maximum number of bathrooms */
export const PROPERTY_MAX_BATHROOMS = Number(
  process.env.EXPO_PUBLIC_PROPERTY_MAX_BATHROOMS ?? '20',
);

/** Maximum number of checklist items */
export const PROPERTY_MAX_CHECKLIST_ITEMS = Number(
  process.env.EXPO_PUBLIC_PROPERTY_MAX_CHECKLIST_ITEMS ?? '30',
);

/** Maximum characters per checklist item */
export const CHECKLIST_ITEM_MAX_LENGTH = Number(
  process.env.EXPO_PUBLIC_PROPERTY_CHECKLIST_ITEM_MAX_LENGTH ?? '200',
);

/** Maximum number of special requirements */
export const PROPERTY_MAX_REQUIREMENTS = Number(
  process.env.EXPO_PUBLIC_PROPERTY_MAX_REQUIREMENTS ?? '20',
);

/** Maximum property name length */
export const PROPERTY_NAME_MAX_LENGTH = Number(
  process.env.EXPO_PUBLIC_PROPERTY_NAME_MAX_LENGTH ?? '100',
);

/** Maximum property description length */
export const PROPERTY_DESCRIPTION_MAX_LENGTH = Number(
  process.env.EXPO_PUBLIC_PROPERTY_DESCRIPTION_MAX_LENGTH ?? '1000',
);

/** Maximum geocoding query length */
export const GEOCODE_QUERY_MAX_LENGTH = Number(
  process.env.EXPO_PUBLIC_GEOCODE_QUERY_MAX_LENGTH ?? '300',
);

// ─── Property Types ──────────────────────────────────────────────────────────

/** All available property types with i18n label keys */
export const PROPERTY_TYPES: { value: PropertyType; labelKey: string }[] = [
  { value: 'apartment', labelKey: 'properties.type.apartment' },
  { value: 'house', labelKey: 'properties.type.house' },
  { value: 'office', labelKey: 'properties.type.office' },
  { value: 'airbnb', labelKey: 'properties.type.airbnb' },
  { value: 'commercial_space', labelKey: 'properties.type.commercial_space' },
  { value: 'other', labelKey: 'properties.type.other' },
];

// ─── Supported Countries ─────────────────────────────────────────────────────

/** Countries supported for property registration */
export const SUPPORTED_COUNTRIES: { code: SupportedCountry; labelKey: string }[] = [
  { code: 'CO', labelKey: 'properties.country.CO' },
  { code: 'US', labelKey: 'properties.country.US' },
  { code: 'CA', labelKey: 'properties.country.CA' },
  { code: 'GB', labelKey: 'properties.country.GB' },
  { code: 'DE', labelKey: 'properties.country.DE' },
  { code: 'FR', labelKey: 'properties.country.FR' },
  { code: 'IT', labelKey: 'properties.country.IT' },
  { code: 'ES', labelKey: 'properties.country.ES' },
  { code: 'PT', labelKey: 'properties.country.PT' },
  { code: 'NL', labelKey: 'properties.country.NL' },
];

// ─── Predefined Special Requirements ─────────────────────────────────────────

/** Common special requirements offered as chips */
export const PREDEFINED_REQUIREMENTS: { value: string; labelKey: string }[] = [
  { value: 'pets', labelKey: 'properties.requirement.pets' },
  { value: 'eco_products', labelKey: 'properties.requirement.eco_products' },
  { value: 'heavy_cleaning', labelKey: 'properties.requirement.heavy_cleaning' },
  { value: 'fragile_items', labelKey: 'properties.requirement.fragile_items' },
  { value: 'allergen_free', labelKey: 'properties.requirement.allergen_free' },
  { value: 'specific_tools', labelKey: 'properties.requirement.specific_tools' },
  { value: 'deep_clean', labelKey: 'properties.requirement.deep_clean' },
  { value: 'move_in_out', labelKey: 'properties.requirement.move_in_out' },
];

// ─── Pagination ──────────────────────────────────────────────────────────────

/** Default page size for property listing */
export const DEFAULT_PAGE_SIZE = Number(
  process.env.EXPO_PUBLIC_PROPERTY_PAGE_SIZE ?? '20',
);

// ─── Design Tokens ───────────────────────────────────────────────────────────

export const COLORS = {
  background: '#0B0C10',
  card: '#1F2833',
  accent: '#00F5D4',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.6)',
  border: 'rgba(255, 255, 255, 0.2)',
  error: '#FF6B6B',
  success: '#00F5D4',
  warning: '#FFD93D',
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const FONT_SIZE = {
  title: 22,
  subtitle: 14,
  body: 16,
  button: 17,
  label: 13,
  caption: 11,
} as const;

// ─── Animation Config ────────────────────────────────────────────────────────

export const SPRING_CONFIG = {
  damping: 14,
  stiffness: 100,
  mass: 1,
} as const;

// ─── Map Defaults ────────────────────────────────────────────────────────────

/** Default map zoom level */
export const DEFAULT_MAP_ZOOM = Number(
  process.env.EXPO_PUBLIC_PROPERTY_DEFAULT_MAP_ZOOM ?? '14',
);

/** Default map center latitude (Bogotá, Colombia) */
export const DEFAULT_MAP_CENTER_LAT = Number(
  process.env.EXPO_PUBLIC_PROPERTY_DEFAULT_MAP_LAT ?? '4.711',
);

/** Default map center longitude (Bogotá, Colombia) */
export const DEFAULT_MAP_CENTER_LNG = Number(
  process.env.EXPO_PUBLIC_PROPERTY_DEFAULT_MAP_LNG ?? '-74.0721',
);
