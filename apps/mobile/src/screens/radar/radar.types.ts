/**
 * Radar screen types — Interfaces for the Cleaner's Offer Radar,
 * including offer data, filters, view modes, WebSocket events,
 * and GeoJSON feature types for Mapbox rendering.
 */

import type { ServiceType } from '../offers/offers.types';

// ─── View & Connection ───────────────────────────────────────────────────────

/** Display mode for the radar screen */
export type ViewMode = 'map' | 'list';

/** Sort options for available offers */
export type SortOption =
  | 'distance_asc'
  | 'price_desc'
  | 'scheduled_asc'
  | 'published_desc';

/** WebSocket connection status */
export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting';

// ─── Radar Offer ─────────────────────────────────────────────────────────────

/** Property snapshot attached to an offer (public view only) */
export interface RadarPropertySnapshot {
  name: string;
  type: string;
  city: string;
  coverPhotoUrl: string | null;
}

/** Price breakdown showing Cleaner payout after commission */
export interface RadarPriceBreakdown {
  offeredPriceCents: number;
  commissionCents: number;
  payoutCents: number;
  currency: string;
}

/** Geographic point (approximate, privacy-preserving) */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * A single offer as displayed on the Radar.
 * Combines server data with client-only display state.
 */
export interface RadarOffer {
  offerId: string;
  propertySnapshot: RadarPropertySnapshot;
  serviceType: ServiceType;
  description: string | null;
  scheduledAt: string;
  timezone: string;
  estimatedDurationMinutes: number;
  priceBreakdown: RadarPriceBreakdown;
  distanceMeters: number;
  publishedAt: string;
  isUrgent: boolean;
  publicLocation: GeoPoint;

  // Client-only state
  /** Whether the Cleaner has opened this offer's preview */
  isViewed: boolean;
  /** Whether data may be outdated (device went offline) */
  isStale: boolean;
}

// ─── Filters ─────────────────────────────────────────────────────────────────

/** Server-side filter parameters for GET /offers/available */
export interface RadarFilters {
  serviceTypes: ServiceType[];
  minPriceCents: number | null;
  maxPriceCents: number | null;
  maxDistanceMeters: number | null;
  scheduledAfter: string | null;
  scheduledBefore: string | null;
}

/** Default (empty) filter state */
export const EMPTY_FILTERS: RadarFilters = {
  serviceTypes: [],
  minPriceCents: null,
  maxPriceCents: null,
  maxDistanceMeters: null,
  scheduledAfter: null,
  scheduledBefore: null,
};

// ─── Pagination ──────────────────────────────────────────────────────────────

export interface RadarPagination {
  page: number;
  totalPages: number;
  total: number;
}

// ─── API Response Types ──────────────────────────────────────────────────────

export interface AvailableOffersResponse {
  items: RadarOffer[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface AvailableOffersSnapshotResponse {
  offers: RadarOffer[];
  syncedAt: string;
}

// ─── WebSocket Event Types ───────────────────────────────────────────────────

/** Event received when a new offer is delivered to the Cleaner */
export interface OfferNewEvent {
  type: 'offer_new';
  offerId: string;
  propertySnapshot: RadarPropertySnapshot;
  serviceType: ServiceType;
  description: string | null;
  scheduledAt: string;
  timezone: string;
  estimatedDurationMinutes: number;
  priceBreakdown: RadarPriceBreakdown;
  distanceMeters: number;
  publishedAt: string;
  isUrgent: boolean;
  publicLocation: GeoPoint;
}

/** Terminal states that cause an offer to be removed from the radar */
export type OfferTerminalState = 'CANCELLED' | 'EXPIRED' | 'MATCHED';

/** Event received when an offer leaves the ACTIVE state */
export interface OfferStatusChangedEvent {
  type: 'offer_status_changed';
  offerId: string;
  state: OfferTerminalState;
  changedAt: string;
}

/** Union of all possible WebSocket events on the radar channel */
export type RadarWebSocketEvent = OfferNewEvent | OfferStatusChangedEvent;

// ─── GeoJSON Types (Mapbox Symbol Layer) ─────────────────────────────────────

/** Properties attached to each offer point in the GeoJSON source */
export interface OfferFeatureProperties {
  offerId: string;
  serviceType: ServiceType;
  payoutCents: number;
  isUrgent: boolean;
  isViewed: boolean;
  isStale: boolean;
}

/** A single offer rendered as a GeoJSON Feature for Mapbox */
export interface OfferFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };
  properties: OfferFeatureProperties;
}

/** GeoJSON FeatureCollection for all radar offers */
export interface OfferFeatureCollection {
  type: 'FeatureCollection';
  features: OfferFeature[];
}
