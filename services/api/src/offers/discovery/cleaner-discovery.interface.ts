import { DiscoveredCleaner, CleanerDiscoveryParams } from './cleaner-discovery.types';

/**
 * Cleaner discovery contract interface.
 *
 * Defines the boundary between the offers module and the cleaner-profiles module.
 * Implementations combine PostGIS geospatial queries with eligibility filtering
 * (KYC approved, availability matching, tier classification).
 *
 * The offers module depends on this interface only — never on internal
 * schemas of the cleaner-profiles module.
 */
export interface CleanerDiscoveryInterface {
  /**
   * Find eligible Cleaners within a given radius of a property location.
   *
   * @param params - Discovery parameters (location, radius, exclusions, tier filter)
   * @returns Array of discovered Cleaners with tier classification
   */
  findEligibleCleaners(params: CleanerDiscoveryParams): Promise<DiscoveredCleaner[]>;
}

/** DI token for CleanerDiscoveryInterface */
export const CLEANER_DISCOVERY = Symbol('CLEANER_DISCOVERY');
