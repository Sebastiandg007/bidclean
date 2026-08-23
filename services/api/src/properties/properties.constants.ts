/**
 * Properties module constants.
 * All configurable business rule values for the properties domain.
 * Validation limits, allowed values, and defaults.
 */

/** Maximum length for property name */
export const PROPERTY_NAME_MAX_LENGTH = 100;

/** Maximum length for property description */
export const PROPERTY_DESCRIPTION_MAX_LENGTH = 2000;

/** Maximum length for street address */
export const ADDRESS_STREET_MAX_LENGTH = 255;

/** Maximum length for city name */
export const ADDRESS_CITY_MAX_LENGTH = 100;

/** Maximum length for state/province name */
export const ADDRESS_STATE_MAX_LENGTH = 100;

/** Maximum length for postal code */
export const ADDRESS_POSTAL_CODE_MAX_LENGTH = 20;

/** Maximum length for formatted address */
export const FORMATTED_ADDRESS_MAX_LENGTH = 500;

/** Maximum length for access instructions */
export const ACCESS_INSTRUCTIONS_MAX_LENGTH = 1000;

/** Maximum length for a single special requirement item */
export const SPECIAL_REQUIREMENT_ITEM_MAX_LENGTH = 100;

/** Maximum number of special requirement items */
export const SPECIAL_REQUIREMENTS_MAX_COUNT = 20;

/** Maximum length for a single checklist item */
export const CHECKLIST_ITEM_MAX_LENGTH = 200;

/** Maximum number of checklist items */
export const CHECKLIST_ITEMS_MAX_COUNT = 30;

/** Maximum page size for property list pagination */
export const PROPERTY_LIST_MAX_PAGE_SIZE = 50;

/** Default page size for property list pagination */
export const PROPERTY_LIST_DEFAULT_PAGE_SIZE = 20;

/** Maximum length for geocode address query */
export const GEOCODE_QUERY_MAX_LENGTH = 300;

/** Supported property types */
export const SUPPORTED_PROPERTY_TYPES = [
  'apartment',
  'house',
  'office',
  'airbnb',
  'commercial_space',
  'other',
] as const;

/** Supported country codes (ISO 3166-1 alpha-2) */
export const SUPPORTED_COUNTRIES = [
  'CO', 'US', 'CA', 'GB', 'DE', 'FR', 'IT', 'ES', 'PT', 'NL',
] as const;

/** Location source values */
export const LOCATION_SOURCES = ['GEOCODED', 'MANUAL'] as const;

/** Mapbox Geocoding API v5 base URL */
export const MAPBOX_GEOCODING_BASE_URL =
  'https://api.mapbox.com/geocoding/v5/mapbox.places';

/** Rate limit sliding window duration in milliseconds (1 minute) */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Allowed sort fields for property listing */
export const ALLOWED_SORT_FIELDS = ['updated_at', 'created_at', 'name'] as const;
