/**
 * Shared types for the property management screens.
 *
 * Properties are the core entity connecting Hosts to physical spaces.
 * Flow: PropertyList → PropertyDetail → Create/Edit Property
 */

/** Property type classification */
export type PropertyType =
  | 'apartment'
  | 'house'
  | 'office'
  | 'airbnb'
  | 'commercial_space'
  | 'other';

/** How geographic coordinates were obtained */
export type LocationSource = 'GEOCODED' | 'MANUAL';

/** Supported countries (ISO 3166-1 alpha-2) */
export type SupportedCountry =
  | 'CO'
  | 'US'
  | 'CA'
  | 'GB'
  | 'DE'
  | 'FR'
  | 'IT'
  | 'ES'
  | 'PT'
  | 'NL';

/** Structured address fields */
export interface PropertyAddress {
  street: string;
  city: string;
  state: string | null;
  postalCode: string | null;
  country: SupportedCountry;
}

/** Geographic coordinates */
export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Property photo with signed URL */
export interface PropertyPhoto {
  id: string;
  url: string;
  displayOrder: number;
  mimeType: string;
  fileSizeBytes: number;
}

/** Full property entity (owner view) */
export interface Property {
  id: string;
  name: string;
  type: PropertyType;
  description: string | null;
  address: PropertyAddress;
  location: Coordinates;
  locationSource: LocationSource;
  formattedAddress: string | null;
  squareMeters: number;
  bedrooms: number;
  bathrooms: number;
  floorNumber: number | null;
  hasParking: boolean;
  hasElevator: boolean;
  specialRequirements: string[];
  checklistItems: string[];
  accessInstructions: string | null;
  photos: PropertyPhoto[];
  isOfferReady: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Property list item (card view — minimal data) */
export interface PropertyListItem {
  id: string;
  name: string;
  type: PropertyType;
  city: string;
  country: SupportedCountry;
  bedrooms: number;
  bathrooms: number;
  coverPhotoUrl: string | null;
  isOfferReady: boolean;
  updatedAt: string;
}

/** Paginated response for property listing */
export interface PaginatedProperties {
  items: PropertyListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Payload for creating a new property */
export interface CreatePropertyPayload {
  name: string;
  type: PropertyType;
  description?: string;
  address: PropertyAddress;
  location: Coordinates;
  locationSource: LocationSource;
  squareMeters: number;
  bedrooms: number;
  bathrooms: number;
  floorNumber?: number;
  hasParking?: boolean;
  hasElevator?: boolean;
  specialRequirements?: string[];
  checklistItems?: string[];
  accessInstructions?: string;
}

/** Payload for updating a property (all fields optional) */
export interface UpdatePropertyPayload {
  name?: string;
  type?: PropertyType;
  description?: string | null;
  address?: PropertyAddress;
  location?: Coordinates;
  locationSource?: LocationSource;
  squareMeters?: number;
  bedrooms?: number;
  bathrooms?: number;
  floorNumber?: number | null;
  hasParking?: boolean;
  hasElevator?: boolean;
  specialRequirements?: string[];
  checklistItems?: string[];
  accessInstructions?: string | null;
}

/** Forward geocoding request */
export interface GeocodeRequest {
  address: string;
  country: SupportedCountry;
}

/** Forward geocoding response */
export interface GeocodeResponse {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  confidence: number;
}

/** Reverse geocoding request */
export interface ReverseGeocodeRequest {
  latitude: number;
  longitude: number;
}

/** Reverse geocoding response */
export interface ReverseGeocodeResponse {
  formattedAddress: string;
  street: string | null;
  city: string;
  state: string | null;
  country: string;
  postalCode: string | null;
}

/** Photo reorder payload */
export interface ReorderPhotosPayload {
  /** Array of photo IDs in the desired display order */
  photoIds: string[];
}

/** Property list query parameters */
export interface PropertyListQuery {
  page?: number;
  limit?: number;
  search?: string;
  type?: PropertyType;
}
