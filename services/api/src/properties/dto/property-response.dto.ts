/**
 * Response DTOs for property endpoints.
 * These define the shape of API responses (not validated — outbound only).
 */

import {
  OwnerPropertyView,
  PublicPropertyView,
  PropertyListItem,
  PaginatedResponse,
  GeocodeResult,
  ReverseGeocodeResult,
} from '../properties.types';

/** Response for GET /properties/:id (owner view) */
export type PropertyDetailResponse = OwnerPropertyView;

/** Response for GET /properties/:id/public (cleaner view) */
export type PublicPropertyResponse = PublicPropertyView;

/** Response for GET /properties (paginated list) */
export type PropertyListResponse = PaginatedResponse<PropertyListItem>;

/** Response for POST /properties/geocode */
export type GeocodeResponse = GeocodeResult;

/** Response for POST /properties/reverse-geocode */
export type ReverseGeocodeResponse = ReverseGeocodeResult;
