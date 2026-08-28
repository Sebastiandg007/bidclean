/**
 * Unit tests for useRadarStore — Zustand store for the Cleaner's Offer Radar.
 *
 * Covers: idempotency, temporal ordering, reconciliation, filters,
 * GeoJSON transformation, stale marking, and active filter count.
 */

import { useRadarStore } from '../useRadarStore';
import type { RadarOffer } from '../radar.types';
import { EMPTY_FILTERS } from '../radar.types';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../radar.api', () => ({
  fetchAvailableOffers: jest.fn(),
  fetchSnapshot: jest.fn(),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockOffer(overrides: Partial<RadarOffer> = {}): RadarOffer {
  return {
    offerId: 'offer-1',
    propertySnapshot: {
      name: 'Apartment 1A',
      type: 'apartment',
      city: 'Bogota',
      coverPhotoUrl: null,
    },
    serviceType: 'standard',
    description: null,
    scheduledAt: '2025-03-01T10:00:00Z',
    timezone: 'America/Bogota',
    estimatedDurationMinutes: 120,
    priceBreakdown: {
      offeredPriceCents: 10000,
      commissionCents: 300,
      payoutCents: 9700,
      currency: 'COP',
    },
    distanceMeters: 1500,
    publishedAt: '2025-02-28T08:00:00Z',
    isUrgent: false,
    publicLocation: { lat: 4.711, lng: -74.0721 },
    isViewed: false,
    isStale: false,
    ...overrides,
  };
}

function resetStore(): void {
  useRadarStore.setState({
    offers: new Map(),
    offerEventTimestamps: new Map(),
    filters: { ...EMPTY_FILTERS },
    sort: 'distance_asc',
    viewMode: 'map',
    connectionStatus: 'disconnected',
    isLoading: false,
    isRefreshing: false,
    pagination: { page: 1, totalPages: 1, total: 0 },
    selectedOfferId: null,
    lastSuccessfulSyncAt: null,
    lastWebSocketEventAt: null,
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useRadarStore', () => {
  beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
  });

  describe('handleOfferNew — idempotency', () => {
    it('should add a new offer to the store', () => {
      const store = useRadarStore.getState();
      const offer = createMockOffer({ offerId: 'offer-abc' });

      store.handleOfferNew(offer);

      const updated = useRadarStore.getState();
      expect(updated.offers.size).toBe(1);
      expect(updated.offers.get('offer-abc')).toBeDefined();
    });

    it('should produce exactly one entry when the same offerId is added multiple times', () => {
      const store = useRadarStore.getState();
      const offer = createMockOffer({ offerId: 'offer-dup' });

      store.handleOfferNew(offer);
      store.handleOfferNew(offer);
      store.handleOfferNew(offer);

      const updated = useRadarStore.getState();
      expect(updated.offers.size).toBe(1);
      expect(updated.offers.has('offer-dup')).toBe(true);
    });

    it('should preserve isViewed status when upserting an existing offer', () => {
      const store = useRadarStore.getState();
      const offer = createMockOffer({ offerId: 'offer-viewed' });

      store.handleOfferNew(offer);
      store.markOfferViewed('offer-viewed');

      // Re-deliver same offer
      store.handleOfferNew(offer);

      const updated = useRadarStore.getState();
      expect(updated.offers.get('offer-viewed')?.isViewed).toBe(true);
    });

    it('should set lastWebSocketEventAt on new offer', () => {
      const store = useRadarStore.getState();
      const offer = createMockOffer({ offerId: 'offer-ts' });

      store.handleOfferNew(offer);

      const updated = useRadarStore.getState();
      expect(updated.lastWebSocketEventAt).not.toBeNull();
    });
  });

  describe('handleOfferStatusChanged — temporal ordering', () => {
    it('should remove an offer when status changes', () => {
      const store = useRadarStore.getState();
      const offer = createMockOffer({ offerId: 'offer-cancel' });

      store.handleOfferNew(offer);
      store.handleOfferStatusChanged('offer-cancel', 'CANCELLED', '2025-03-01T12:00:00Z');

      const updated = useRadarStore.getState();
      expect(updated.offers.has('offer-cancel')).toBe(false);
    });

    it('should discard an older event arriving after a newer one', () => {
      const store = useRadarStore.getState();
      const offer = createMockOffer({ offerId: 'offer-order' });

      store.handleOfferNew(offer);

      // Newer event first
      store.handleOfferStatusChanged('offer-order', 'MATCHED', '2025-03-01T12:05:00Z');
      // Older event arrives late
      store.handleOfferStatusChanged('offer-order', 'CANCELLED', '2025-03-01T12:00:00Z');

      const updated = useRadarStore.getState();
      // Offer should remain removed (first event already removed it)
      expect(updated.offers.has('offer-order')).toBe(false);
      // Timestamp should reflect the latest event
      expect(updated.offerEventTimestamps.get('offer-order')).toBe('2025-03-01T12:05:00Z');
    });

    it('should apply a newer event that arrives after an older one', () => {
      const store = useRadarStore.getState();
      const offer = createMockOffer({ offerId: 'offer-seq' });

      store.handleOfferNew(offer);
      store.handleOfferStatusChanged('offer-seq', 'CANCELLED', '2025-03-01T12:00:00Z');

      // Even later event
      store.handleOfferStatusChanged('offer-seq', 'EXPIRED', '2025-03-01T12:10:00Z');

      const updated = useRadarStore.getState();
      expect(updated.offerEventTimestamps.get('offer-seq')).toBe('2025-03-01T12:10:00Z');
    });

    it('should update lastWebSocketEventAt on status change', () => {
      const store = useRadarStore.getState();
      const offer = createMockOffer({ offerId: 'offer-ws' });

      store.handleOfferNew(offer);
      store.handleOfferStatusChanged('offer-ws', 'CANCELLED', '2025-03-01T12:00:00Z');

      const updated = useRadarStore.getState();
      expect(updated.lastWebSocketEventAt).not.toBeNull();
    });
  });

  describe('reconcile — REST wins', () => {
    it('should replace all local offers with snapshot', async () => {
      const { fetchSnapshot } = require('../radar.api');
      const snapshotOffers = [
        createMockOffer({ offerId: 'snap-1' }),
        createMockOffer({ offerId: 'snap-2' }),
      ];
      (fetchSnapshot as jest.Mock).mockResolvedValue({
        offers: snapshotOffers,
        syncedAt: '2025-03-01T14:00:00Z',
      });

      // Pre-populate local state
      const store = useRadarStore.getState();
      store.handleOfferNew(createMockOffer({ offerId: 'local-1' }));
      store.handleOfferNew(createMockOffer({ offerId: 'local-2' }));
      store.handleOfferNew(createMockOffer({ offerId: 'local-3' }));

      await useRadarStore.getState().reconcile();

      const updated = useRadarStore.getState();
      expect(updated.offers.size).toBe(2);
      expect(updated.offers.has('snap-1')).toBe(true);
      expect(updated.offers.has('snap-2')).toBe(true);
      expect(updated.offers.has('local-1')).toBe(false);
      expect(updated.offers.has('local-2')).toBe(false);
      expect(updated.offers.has('local-3')).toBe(false);
    });

    it('should clear event timestamps after reconciliation', async () => {
      const { fetchSnapshot } = require('../radar.api');
      (fetchSnapshot as jest.Mock).mockResolvedValue({
        offers: [],
        syncedAt: '2025-03-01T14:00:00Z',
      });

      // Add event timestamps
      const store = useRadarStore.getState();
      store.handleOfferNew(createMockOffer({ offerId: 'ts-offer' }));
      store.handleOfferStatusChanged('ts-offer', 'CANCELLED', '2025-03-01T12:00:00Z');

      await useRadarStore.getState().reconcile();

      const updated = useRadarStore.getState();
      expect(updated.offerEventTimestamps.size).toBe(0);
    });

    it('should update lastSuccessfulSyncAt with snapshot syncedAt', async () => {
      const { fetchSnapshot } = require('../radar.api');
      (fetchSnapshot as jest.Mock).mockResolvedValue({
        offers: [],
        syncedAt: '2025-03-01T15:30:00Z',
      });

      await useRadarStore.getState().reconcile();

      const updated = useRadarStore.getState();
      expect(updated.lastSuccessfulSyncAt).toBe('2025-03-01T15:30:00Z');
    });

    it('should keep existing state if reconcile fails', async () => {
      const { fetchSnapshot } = require('../radar.api');
      (fetchSnapshot as jest.Mock).mockRejectedValue(new Error('Network error'));

      const store = useRadarStore.getState();
      store.handleOfferNew(createMockOffer({ offerId: 'kept-offer' }));

      await useRadarStore.getState().reconcile();

      const updated = useRadarStore.getState();
      expect(updated.offers.has('kept-offer')).toBe(true);
    });
  });

  describe('setFilters', () => {
    it('should update filter state with partial filters', () => {
      const { fetchAvailableOffers } = require('../radar.api');
      (fetchAvailableOffers as jest.Mock).mockResolvedValue({
        items: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });

      const store = useRadarStore.getState();
      store.setFilters({ minPriceCents: 5000, maxPriceCents: 20000 });

      const updated = useRadarStore.getState();
      expect(updated.filters.minPriceCents).toBe(5000);
      expect(updated.filters.maxPriceCents).toBe(20000);
      // Other filters remain default
      expect(updated.filters.serviceTypes).toEqual([]);
      expect(updated.filters.maxDistanceMeters).toBeNull();
    });

    it('should merge with existing filters', () => {
      const { fetchAvailableOffers } = require('../radar.api');
      (fetchAvailableOffers as jest.Mock).mockResolvedValue({
        items: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });

      const store = useRadarStore.getState();
      store.setFilters({ minPriceCents: 5000 });
      store.setFilters({ maxDistanceMeters: 3000 });

      const updated = useRadarStore.getState();
      expect(updated.filters.minPriceCents).toBe(5000);
      expect(updated.filters.maxDistanceMeters).toBe(3000);
    });
  });

  describe('clearFilters', () => {
    it('should reset all filters to empty state', () => {
      const { fetchAvailableOffers } = require('../radar.api');
      (fetchAvailableOffers as jest.Mock).mockResolvedValue({
        items: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });

      const store = useRadarStore.getState();
      store.setFilters({
        serviceTypes: ['deep', 'standard'],
        minPriceCents: 5000,
        maxPriceCents: 50000,
        maxDistanceMeters: 2000,
        scheduledAfter: '2025-03-01T00:00:00Z',
        scheduledBefore: '2025-03-07T00:00:00Z',
      });

      useRadarStore.getState().clearFilters();

      const updated = useRadarStore.getState();
      expect(updated.filters).toEqual(EMPTY_FILTERS);
    });
  });

  describe('getOffersAsGeoJSON', () => {
    it('should return empty FeatureCollection when no offers', () => {
      const result = useRadarStore.getState().getOffersAsGeoJSON();

      expect(result.type).toBe('FeatureCollection');
      expect(result.features).toEqual([]);
    });

    it('should transform offers into GeoJSON features correctly', () => {
      const store = useRadarStore.getState();
      store.handleOfferNew(
        createMockOffer({
          offerId: 'geo-1',
          publicLocation: { lat: 4.711, lng: -74.072 },
          serviceType: 'deep',
          isUrgent: true,
        }),
      );

      const result = useRadarStore.getState().getOffersAsGeoJSON();

      expect(result.features).toHaveLength(1);
      const feature = result.features[0]!;
      expect(feature.type).toBe('Feature');
      expect(feature.geometry.type).toBe('Point');
      expect(feature.geometry.coordinates).toEqual([-74.072, 4.711]);
      expect(feature.properties.offerId).toBe('geo-1');
      expect(feature.properties.serviceType).toBe('deep');
      expect(feature.properties.isUrgent).toBe(true);
      expect(feature.properties.isViewed).toBe(false);
      expect(feature.properties.isStale).toBe(false);
    });

    it('should include payoutCents in properties', () => {
      const store = useRadarStore.getState();
      store.handleOfferNew(
        createMockOffer({
          offerId: 'geo-price',
          priceBreakdown: {
            offeredPriceCents: 15000,
            commissionCents: 450,
            payoutCents: 14550,
            currency: 'USD',
          },
        }),
      );

      const result = useRadarStore.getState().getOffersAsGeoJSON();
      expect(result.features[0]!.properties.payoutCents).toBe(14550);
    });
  });

  describe('markAllStale', () => {
    it('should set isStale=true on all offers', () => {
      const store = useRadarStore.getState();
      store.handleOfferNew(createMockOffer({ offerId: 'stale-1' }));
      store.handleOfferNew(createMockOffer({ offerId: 'stale-2' }));
      store.handleOfferNew(createMockOffer({ offerId: 'stale-3' }));

      useRadarStore.getState().markAllStale();

      const updated = useRadarStore.getState();
      for (const [, offer] of updated.offers) {
        expect(offer.isStale).toBe(true);
      }
    });

    it('should not remove any offers', () => {
      const store = useRadarStore.getState();
      store.handleOfferNew(createMockOffer({ offerId: 's-1' }));
      store.handleOfferNew(createMockOffer({ offerId: 's-2' }));

      useRadarStore.getState().markAllStale();

      const updated = useRadarStore.getState();
      expect(updated.offers.size).toBe(2);
    });
  });

  describe('getActiveFilterCount', () => {
    it('should return 0 when no filters are active', () => {
      const count = useRadarStore.getState().getActiveFilterCount();
      expect(count).toBe(0);
    });

    it('should count each active filter independently', () => {
      const { fetchAvailableOffers } = require('../radar.api');
      (fetchAvailableOffers as jest.Mock).mockResolvedValue({
        items: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });

      const store = useRadarStore.getState();
      store.setFilters({
        serviceTypes: ['standard'],
        minPriceCents: 1000,
        maxPriceCents: 50000,
      });

      const count = useRadarStore.getState().getActiveFilterCount();
      expect(count).toBe(3);
    });

    it('should count all 6 possible filter categories', () => {
      const { fetchAvailableOffers } = require('../radar.api');
      (fetchAvailableOffers as jest.Mock).mockResolvedValue({
        items: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });

      const store = useRadarStore.getState();
      store.setFilters({
        serviceTypes: ['deep', 'recurring'],
        minPriceCents: 2000,
        maxPriceCents: 80000,
        maxDistanceMeters: 5000,
        scheduledAfter: '2025-03-01T00:00:00Z',
        scheduledBefore: '2025-03-31T00:00:00Z',
      });

      const count = useRadarStore.getState().getActiveFilterCount();
      expect(count).toBe(6);
    });
  });

  describe('getOffersList — sorted output', () => {
    it('should return offers sorted by distance ascending by default', () => {
      const store = useRadarStore.getState();
      store.handleOfferNew(createMockOffer({ offerId: 'far', distanceMeters: 5000 }));
      store.handleOfferNew(createMockOffer({ offerId: 'near', distanceMeters: 500 }));
      store.handleOfferNew(createMockOffer({ offerId: 'mid', distanceMeters: 2000 }));

      const list = useRadarStore.getState().getOffersList();
      expect(list[0]!.offerId).toBe('near');
      expect(list[1]!.offerId).toBe('mid');
      expect(list[2]!.offerId).toBe('far');
    });
  });

  describe('markOfferViewed', () => {
    it('should mark a specific offer as viewed', () => {
      const store = useRadarStore.getState();
      store.handleOfferNew(createMockOffer({ offerId: 'view-me' }));

      store.markOfferViewed('view-me');

      const updated = useRadarStore.getState();
      expect(updated.offers.get('view-me')?.isViewed).toBe(true);
    });

    it('should not throw when offer does not exist', () => {
      const store = useRadarStore.getState();
      expect(() => store.markOfferViewed('nonexistent')).not.toThrow();
    });
  });

  describe('setConnectionStatus', () => {
    it('should update connection status', () => {
      const store = useRadarStore.getState();
      store.setConnectionStatus('connected');

      expect(useRadarStore.getState().connectionStatus).toBe('connected');

      store.setConnectionStatus('reconnecting');
      expect(useRadarStore.getState().connectionStatus).toBe('reconnecting');
    });
  });

  describe('selectOffer', () => {
    it('should set selectedOfferId', () => {
      const store = useRadarStore.getState();
      store.selectOffer('offer-xyz');

      expect(useRadarStore.getState().selectedOfferId).toBe('offer-xyz');
    });

    it('should clear selectedOfferId when null', () => {
      const store = useRadarStore.getState();
      store.selectOffer('offer-xyz');
      store.selectOffer(null);

      expect(useRadarStore.getState().selectedOfferId).toBeNull();
    });
  });

  describe('setViewMode', () => {
    it('should toggle between map and list', () => {
      const store = useRadarStore.getState();
      store.setViewMode('list');
      expect(useRadarStore.getState().viewMode).toBe('list');

      store.setViewMode('map');
      expect(useRadarStore.getState().viewMode).toBe('map');
    });
  });
});
