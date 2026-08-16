/**
 * Offer-related type definitions shared across the platform.
 */

export const OfferStatus = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  MATCHED: 'matched',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  DISPUTED: 'disputed',
} as const;

export type OfferStatus = typeof OfferStatus[keyof typeof OfferStatus];

export const ServiceType = {
  FULL_CLEANING: 'full_cleaning',
  BATHROOM_ONLY: 'bathroom_only',
  KITCHEN_ONLY: 'kitchen_only',
  SINGLE_FLOOR: 'single_floor',
  POST_EVENT: 'post_event',
  LINEN_CHANGE: 'linen_change',
  PET_CARE: 'pet_care',
  CUSTOM: 'custom',
} as const;

export type ServiceType = typeof ServiceType[keyof typeof ServiceType];

export const PropertyType = {
  APARTMENT: 'apartment',
  HOUSE: 'house',
  OFFICE: 'office',
  AIRBNB: 'airbnb',
  COMMERCIAL: 'commercial',
} as const;

export type PropertyType = typeof PropertyType[keyof typeof PropertyType];

export interface GeoLocation {
  readonly latitude: number;
  readonly longitude: number;
}

export interface OfferSummary {
  readonly id: string;
  readonly propertyType: PropertyType;
  readonly serviceType: ServiceType;
  readonly status: OfferStatus;
  readonly price: number;
  readonly currency: string;
  readonly location: GeoLocation;
  readonly distanceKm: number;
  readonly scheduledAt: string;
  readonly createdAt: string;
}
