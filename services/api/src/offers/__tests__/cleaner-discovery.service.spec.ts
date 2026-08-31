/**
 * CleanerDiscoveryService unit tests.
 *
 * The service is currently a stub (real PostGIS + eligibility querying is owned by
 * the cleaner-profiles module). These tests pin the stub contract so a future real
 * implementation can be swapped in behind the same interface without surprises.
 */
import { CleanerDiscoveryService } from '../discovery/cleaner-discovery.service';
import { CleanerDiscoveryParams } from '../discovery/cleaner-discovery.types';

describe('CleanerDiscoveryService', () => {
  let service: CleanerDiscoveryService;

  beforeEach(() => {
    service = new CleanerDiscoveryService();
  });

  const params: CleanerDiscoveryParams = {
    lat: 4.711,
    lng: -74.072,
    radiusMeters: 5000,
    hostId: 'host-1',
    excludeCleanerIds: ['cleaner-already'],
    favoritesFirst: true,
  };

  describe('findEligibleCleaners', () => {
    it('should return empty array in stub implementation', async () => {
      await expect(service.findEligibleCleaners(params)).resolves.toEqual([]);
    });

    it('should accept valid discovery params without error', async () => {
      await expect(
        service.findEligibleCleaners({
          lat: 0,
          lng: 0,
          radiusMeters: 25000,
          hostId: 'host-2',
          excludeCleanerIds: [],
          favoritesFirst: false,
        }),
      ).resolves.toEqual([]);
    });
  });
});
