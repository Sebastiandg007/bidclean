import { DeliveryTier } from '../offers.types';

/**
 * Types for the Cleaner discovery contract.
 */

/** Parameters for Cleaner discovery query */
export interface CleanerDiscoveryParams {
  /** Property latitude */
  readonly lat: number;
  /** Property longitude */
  readonly lng: number;
  /** Search radius in meters */
  readonly radiusMeters: number;
  /** Host ID (for favorites lookup) */
  readonly hostId: string;
  /** Cleaner IDs to exclude (already delivered) */
  readonly excludeCleanerIds: string[];
  /** Whether favorites-first is enabled for this offer */
  readonly favoritesFirst: boolean;
}

/** A Cleaner discovered within the search radius */
export interface DiscoveredCleaner {
  /** Cleaner user ID */
  readonly cleanerId: string;
  /** Cleaner's current location (for distance calculation) */
  readonly lat: number;
  readonly lng: number;
  /** Distance from property in meters */
  readonly distanceMeters: number;
  /** Delivery tier classification */
  readonly tier: DeliveryTier;
}
