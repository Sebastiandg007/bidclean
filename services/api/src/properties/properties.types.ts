/**
 * Properties module type definitions.
 */

/** Supported property types */
export type PropertyType =
  | 'apartment'
  | 'house'
  | 'office'
  | 'airbnb'
  | 'commercial_space'
  | 'other';

/** Supported country codes (ISO 3166-1 alpha-2) */
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

/** How location coordinates were obtained */
export type LocationSource = 'GEOCODED' | 'MANUAL';

/** Structured address fields */
export interface PropertyAddress {
  readonly street: string;
  readonly city: string;
  readonly state: string | null;
  readonly postalCode: string | null;
  readonly country: SupportedCountry;
}

/** Geographic coordinates */
export interface Coordinates {
  readonly lat: number;
  readonly lng: number;
}

/** Property dimensions */
export interface PropertyDimensions {
  readonly squareMeters: number;
  readonly bedrooms: number;
  readonly bathrooms: number;
  readonly floorNumber: number | null;
}

/** Property amenities */
export interface PropertyAmenities {
  readonly hasParking: boolean;
  readonly hasElevator: boolean;
  readonly specialRequirements: string[];
}

/** Full property data (owner view) */
export interface OwnerPropertyView {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly type: PropertyType;
  readonly description: string | null;
  readonly address: PropertyAddress;
  readonly formattedAddress: string | null;
  readonly location: Coordinates;
  readonly locationSource: LocationSource;
  readonly dimensions: PropertyDimensions;
  readonly amenities: PropertyAmenities;
  readonly checklistItems: string[];
  readonly accessInstructions: string | null;
  readonly photos: PropertyPhotoView[];
  readonly isOfferReady: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Public property data (Cleaner view — no private fields) */
export interface PublicPropertyView {
  readonly id: string;
  readonly name: string;
  readonly type: PropertyType;
  readonly description: string | null;
  readonly city: string;
  readonly country: SupportedCountry;
  readonly dimensions: PropertyDimensions;
  readonly amenities: PropertyAmenities;
  readonly checklistItems: string[];
  readonly photos: PropertyPhotoView[];
}

/** Property photo with signed URL */
export interface PropertyPhotoView {
  readonly id: string;
  readonly url: string;
  readonly mimeType: string;
  readonly fileSizeBytes: number;
  readonly displayOrder: number;
}

/** Property list item (card view) */
export interface PropertyListItem {
  readonly id: string;
  readonly name: string;
  readonly type: PropertyType;
  readonly city: string;
  readonly country: SupportedCountry;
  readonly bedrooms: number;
  readonly bathrooms: number;
  readonly coverPhotoUrl: string | null;
  readonly isOfferReady: boolean;
}

/** Paginated response wrapper */
export interface PaginatedResponse<T> {
  readonly items: T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

/** Offer-readiness result */
export interface OfferReadinessResult {
  readonly ready: boolean;
  readonly reasons: string[];
}

/** Forward geocoding result */
export interface GeocodeResult {
  readonly lat: number;
  readonly lng: number;
  readonly formattedAddress: string;
  readonly confidence: number;
}

/** Reverse geocoding result */
export interface ReverseGeocodeResult {
  readonly formattedAddress: string;
  readonly street: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly country: string | null;
  readonly postalCode: string | null;
}
