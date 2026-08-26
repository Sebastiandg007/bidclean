import { ServiceType } from '../../offers.types';
import { AvailableOffersSortOption } from './available-offers-query.dto';

/**
 * Internal types used by the available offers service and repository.
 * These types are NOT exposed in API responses — only used for internal data flow.
 */

/**
 * Parsed filter parameters passed from service to repository.
 * All values are pre-validated by the DTO layer.
 */
export interface AvailableOffersFilters {
  readonly cleanerId: string;
  readonly serviceTypes?: ServiceType[];
  readonly minPriceCents?: number;
  readonly maxPriceCents?: number;
  readonly maxDistanceMeters?: number;
  readonly scheduledBefore?: string;
  readonly scheduledAfter?: string;
  readonly sort: AvailableOffersSortOption;
  readonly page: number;
  readonly limit: number;
}

/**
 * Raw database row returned by the PostGIS query.
 * Maps directly to SQL SELECT column aliases.
 */
export interface AvailableOfferRow {
  readonly offer_id: string;
  readonly property_name_snapshot: string;
  readonly property_type_snapshot: string;
  readonly property_city_snapshot: string;
  readonly property_cover_photo_snapshot: string | null;
  readonly service_type: string;
  readonly description: string | null;
  readonly scheduled_at: Date;
  readonly timezone: string;
  readonly estimated_duration_minutes: number;
  readonly offered_price_cents: number;
  readonly cleaner_commission_cents: number;
  readonly cleaner_payout_cents: number;
  readonly currency: string;
  readonly published_at: Date;
  readonly distance_meters: number;
  readonly is_urgent: boolean;
  readonly public_lat: number;
  readonly public_lng: number;
}

/**
 * Paginated result from the repository layer.
 * Contains raw rows and total count for pagination math.
 */
export interface AvailableOffersQueryResult {
  readonly rows: AvailableOfferRow[];
  readonly total: number;
}

/**
 * Snapshot result from the repository (unpaginated).
 * Used exclusively for WebSocket reconnection reconciliation.
 */
export interface AvailableOffersSnapshotResult {
  readonly rows: AvailableOfferRow[];
}
