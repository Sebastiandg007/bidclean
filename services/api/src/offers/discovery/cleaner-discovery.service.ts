import { Injectable, Logger } from '@nestjs/common';
import { CleanerDiscoveryInterface } from './cleaner-discovery.interface';
import { DiscoveredCleaner, CleanerDiscoveryParams } from './cleaner-discovery.types';

/**
 * Stub implementation of CleanerDiscoveryInterface.
 *
 * Returns an empty array until the cleaner-profiles module provides
 * a real implementation with PostGIS geospatial queries and eligibility checks.
 *
 * This stub allows the offers module to be developed and tested independently.
 */
@Injectable()
export class CleanerDiscoveryService implements CleanerDiscoveryInterface {
  private readonly logger = new Logger(CleanerDiscoveryService.name);

  /**
   * Stub: returns empty array.
   * Real implementation will query PostGIS + cleaner eligibility.
   */
  async findEligibleCleaners(
    params: CleanerDiscoveryParams,
  ): Promise<DiscoveredCleaner[]> {
    this.logger.debug(
      `CleanerDiscovery stub called for radius ${params.radiusMeters}m`,
    );
    return [];
  }
}
