/**
 * Geocoding service type definitions.
 */

/** Forward geocoding request */
export interface ForwardGeocodeRequest {
  readonly address: string;
  readonly country: string;
}

/** Forward geocoding response from Mapbox */
export interface ForwardGeocodeResponse {
  readonly lat: number;
  readonly lng: number;
  readonly formattedAddress: string;
  readonly confidence: number;
}

/** Reverse geocoding request */
export interface ReverseGeocodeRequest {
  readonly lat: number;
  readonly lng: number;
}

/** Reverse geocoding response from Mapbox */
export interface ReverseGeocodeResponse {
  readonly formattedAddress: string;
  readonly street: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly country: string | null;
  readonly postalCode: string | null;
}

/** Mapbox API feature response (simplified) */
export interface MapboxFeature {
  readonly place_name: string;
  readonly center: [number, number]; // [lng, lat]
  readonly relevance: number;
  readonly context?: MapboxContext[];
}

/** Mapbox context entry for address components */
export interface MapboxContext {
  readonly id: string;
  readonly text: string;
  readonly short_code?: string;
}

/** Geocoding error info */
export interface GeocodingError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}
