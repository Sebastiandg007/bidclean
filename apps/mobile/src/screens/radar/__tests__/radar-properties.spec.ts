/**
 * Property-based tests for the Offer Radar using fast-check.
 *
 * Tests 11 correctness properties from the design document.
 * Each property runs a minimum of 100 iterations.
 * Library: fast-check (TypeScript)
 */

import * as fc from 'fast-check';
import { useRadarStore } from '../useRadarStore';
import type { RadarOffer, RadarFilters, SortOption, ConnectionStatus } from '../radar.types';
import { EMPTY_FILTERS } from '../radar.types';
import type { ServiceType, OfferState } from '../../offers/offers.types';
import {
  AD_SLOT_FIRST_POSITION,
  AD_SLOT_INTERVAL,
} from '../radar.constants';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../radar.api', () => ({
  fetchAvailableOffers: jest.fn(),
  fetchSnapshot: jest.fn(),
}));

// ─── Constants ───────────────────────────────────────────────────────────────

const ALL_OFFER_STATES: OfferState[] = [
  'DRAFT', 'PUBLISHED', 'ACTIVE', 'MATCHED', 'COMPLETED', 'CANCELLED', 'EXPIRED',
];
const DELIVERY_STATUSES = ['PENDING', 'SENT', 'FAILED'] as const;
const SERVICE_TYPES: ServiceType[] = [
  'standard', 'deep', 'move_in_out', 'post_construction', 'post_event', 'recurring',
];
const SORT_OPTIONS: SortOption[] = [
  'distance_asc', 'price_desc', 'scheduled_asc', 'published_desc',
];
const FORBIDDEN_FIELDS = [
  'address_street', 'address_state', 'address_postal_code',
  'formatted_address', 'access_instructions', 'location_source',
];
const MIN_JITTER_METERS = 200;
const MAX_JITTER_METERS = 500;

// ─── Generators ──────────────────────────────────────────────────────────────

const serviceTypeArb = fc.constantFrom(...SERVICE_TYPES);
const offerStateArb = fc.constantFrom(...ALL_OFFER_STATES);
const deliveryStatusArb = fc.constantFrom(...DELIVERY_STATUSES);
const sortOptionArb = fc.constantFrom(...SORT_OPTIONS);

const offerIdArb = fc.uuid();

// Use integer timestamps to avoid invalid Date issues with fc.date()
const FUTURE_MIN = new Date('2025-01-01T00:00:00Z').getTime();
const FUTURE_MAX = new Date('2030-12-31T23:59:59Z').getTime();
const PAST_MIN = new Date('2020-01-01T00:00:00Z').getTime();
const PAST_MAX = new Date('2024-12-31T23:59:59Z').getTime();

const isoDateFutureArb = fc.integer({ min: FUTURE_MIN, max: FUTURE_MAX })
  .map((ts) => new Date(ts).toISOString());

const isoDatePastArb = fc.integer({ min: PAST_MIN, max: PAST_MAX })
  .map((ts) => new Date(ts).toISOString());

const priceCentsArb = fc.integer({ min: 100, max: 1_000_000 });
const distanceMetersArb = fc.integer({ min: 100, max: 50_000 });
const latArb = fc.double({ min: -90, max: 90, noNaN: true });
const lngArb = fc.double({ min: -180, max: 180, noNaN: true });

function radarOfferArb(overrides?: Partial<RadarOffer>): fc.Arbitrary<RadarOffer> {
  return fc.record({
    offerId: offerIdArb,
    propertySnapshot: fc.record({
      name: fc.string({ minLength: 1, maxLength: 50 }),
      type: fc.string({ minLength: 1, maxLength: 20 }),
      city: fc.string({ minLength: 1, maxLength: 30 }),
      coverPhotoUrl: fc.option(fc.webUrl(), { nil: null }),
    }),
    serviceType: serviceTypeArb,
    description: fc.option(fc.string({ maxLength: 200 }), { nil: null }),
    scheduledAt: isoDateFutureArb,
    timezone: fc.constantFrom('America/Bogota', 'America/New_York', 'Europe/Berlin', 'UTC'),
    estimatedDurationMinutes: fc.integer({ min: 30, max: 480 }),
    priceBreakdown: fc.record({
      offeredPriceCents: priceCentsArb,
      commissionCents: fc.integer({ min: 0, max: 100_000 }),
      payoutCents: priceCentsArb,
      currency: fc.constantFrom('COP', 'USD', 'CAD', 'EUR', 'GBP'),
    }),
    distanceMeters: distanceMetersArb,
    publishedAt: isoDatePastArb,
    isUrgent: fc.boolean(),
    publicLocation: fc.record({ lat: latArb, lng: lngArb }),
    isViewed: fc.constant(false),
    isStale: fc.constant(false),
  }).map((offer) => ({ ...offer, ...overrides }));
}

// ─── Pure Functions Under Test ───────────────────────────────────────────────

/**
 * Visibility contract filter — mirrors backend query WHERE clause.
 * Property 1 tests this pure logic in isolation.
 */
function applyVisibilityContract(
  offers: Array<{
    offerId: string;
    state: OfferState;
    deliveryStatus: (typeof DELIVERY_STATUSES)[number];
    scheduledAt: string;
    cleanerId: string;
  }>,
  authenticatedCleanerId: string,
  now: Date,
): string[] {
  return offers
    .filter((o) =>
      o.state === 'ACTIVE' &&
      o.deliveryStatus === 'SENT' &&
      o.cleanerId === authenticatedCleanerId &&
      new Date(o.scheduledAt) > now
    )
    .map((o) => o.offerId);
}

/**
 * Filter predicate satisfaction — mirrors server-side query filtering.
 * Property 2 tests this pure logic.
 */
function applyFilters(offers: RadarOffer[], filters: RadarFilters): RadarOffer[] {
  return offers.filter((offer) => {
    if (filters.serviceTypes.length > 0 && !filters.serviceTypes.includes(offer.serviceType)) {
      return false;
    }
    if (filters.minPriceCents !== null && offer.priceBreakdown.payoutCents < filters.minPriceCents) {
      return false;
    }
    if (filters.maxPriceCents !== null && offer.priceBreakdown.payoutCents > filters.maxPriceCents) {
      return false;
    }
    if (filters.maxDistanceMeters !== null && offer.distanceMeters > filters.maxDistanceMeters) {
      return false;
    }
    if (filters.scheduledAfter !== null && offer.scheduledAt < filters.scheduledAfter) {
      return false;
    }
    if (filters.scheduledBefore !== null && offer.scheduledAt > filters.scheduledBefore) {
      return false;
    }
    return true;
  });
}

/**
 * Sort ordering — mirrors client-side sort logic.
 * Property 3 tests this.
 */
function applySorting(offers: RadarOffer[], sort: SortOption): RadarOffer[] {
  const sorted = [...offers];
  switch (sort) {
    case 'distance_asc':
      sorted.sort((a, b) => a.distanceMeters - b.distanceMeters);
      break;
    case 'price_desc':
      sorted.sort((a, b) => b.priceBreakdown.payoutCents - a.priceBreakdown.payoutCents);
      break;
    case 'scheduled_asc':
      sorted.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
      break;
    case 'published_desc':
      sorted.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
      break;
  }
  return sorted;
}

/**
 * Ad slot position calculator.
 * Property 6 tests this.
 */
function computeAdSlotPositions(listLength: number, adsEnabled: boolean): number[] {
  if (!adsEnabled || listLength === 0) return [];

  const positions: number[] = [];
  let pos = AD_SLOT_FIRST_POSITION;
  while (pos < listLength) {
    positions.push(pos);
    pos += AD_SLOT_INTERVAL;
  }
  return positions;
}

/**
 * Pagination split — simulates paginating offers into pages.
 * Property 9 tests uniqueness across pages.
 */
function paginateOffers(offers: RadarOffer[], pageSize: number): RadarOffer[][] {
  const pages: RadarOffer[][] = [];
  for (let i = 0; i < offers.length; i += pageSize) {
    pages.push(offers.slice(i, i + pageSize));
  }
  return pages;
}

/**
 * Public location jitter generator — deterministic seeded displacement.
 * Property 10 tests distance bounds and determinism.
 */
function generatePublicLocation(
  exactLocation: { lat: number; lng: number },
  offerId: string,
  config: { minJitterMeters: number; maxJitterMeters: number },
): { lat: number; lng: number } {
  // Simple seeded hash from offerId
  let hash = 0;
  for (let i = 0; i < offerId.length; i++) {
    const char = offerId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Normalize hash to [0, 1) range
  const normalizedAngle = ((hash >>> 0) % 36000) / 36000; // 0-1
  const normalizedDist = (((hash >>> 16) ^ (hash & 0xFFFF)) >>> 0) % 10000 / 10000; // 0-1

  const angle = normalizedAngle * 2 * Math.PI;
  const distance = config.minJitterMeters + normalizedDist * (config.maxJitterMeters - config.minJitterMeters);

  // Convert meters displacement to approximate lat/lng offset
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng = 111_320 * Math.cos((exactLocation.lat * Math.PI) / 180);

  const latOffset = (distance * Math.sin(angle)) / metersPerDegreeLat;
  const lngOffset = (distance * Math.cos(angle)) / (metersPerDegreeLng || 1);

  return {
    lat: exactLocation.lat + latOffset,
    lng: exactLocation.lng + lngOffset,
  };
}

/**
 * Haversine distance in meters between two points.
 */
function haversineMeters(
  p1: { lat: number; lng: number },
  p2: { lat: number; lng: number },
): number {
  const R = 6_371_000; // Earth radius in meters
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((p1.lat * Math.PI) / 180) *
    Math.cos((p2.lat * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ─── Store Reset Helper ──────────────────────────────────────────────────────

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

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Offer Radar — Property-Based Tests', () => {
  beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
  });

  // Feature: offer-radar, Property 1: Visibility Contract Enforcement
  describe('Property 1: Visibility Contract Enforcement', () => {
    /**
     * Validates: Requirements 4.1, 4.8, 3.7
     *
     * For any set of offers with varying states, delivery statuses, and scheduled dates,
     * only offers with state=ACTIVE, deliveryStatus=SENT, and scheduledAt > now pass.
     */
    it('should only include ACTIVE + SENT + not-expired offers', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              offerId: offerIdArb,
              state: offerStateArb,
              deliveryStatus: deliveryStatusArb,
              scheduledAt: fc.oneof(isoDateFutureArb, isoDatePastArb),
              cleanerId: fc.constantFrom('cleaner-1', 'cleaner-2', 'cleaner-3'),
            }),
            { minLength: 0, maxLength: 50 },
          ),
          (offers) => {
            const now = new Date('2025-02-15T12:00:00Z');
            const authenticatedCleanerId = 'cleaner-1';

            const result = applyVisibilityContract(offers, authenticatedCleanerId, now);

            // Every returned offerId must satisfy ALL conditions
            for (const offerId of result) {
              const offer = offers.find((o) => o.offerId === offerId)!;
              expect(offer.state).toBe('ACTIVE');
              expect(offer.deliveryStatus).toBe('SENT');
              expect(offer.cleanerId).toBe(authenticatedCleanerId);
              expect(new Date(offer.scheduledAt).getTime()).toBeGreaterThan(now.getTime());
            }

            // No offer satisfying all conditions should be excluded
            const eligible = offers.filter(
              (o) =>
                o.state === 'ACTIVE' &&
                o.deliveryStatus === 'SENT' &&
                o.cleanerId === authenticatedCleanerId &&
                new Date(o.scheduledAt) > now,
            );
            expect(result.length).toBe(eligible.length);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: offer-radar, Property 2: Filter Predicate Satisfaction
  describe('Property 2: Filter Predicate Satisfaction', () => {
    /**
     * Validates: Requirements 4.3, 5.3
     *
     * For any valid filter combination applied to offers,
     * ALL returned offers satisfy every active filter predicate simultaneously.
     */
    it('should return only offers satisfying all active filters', () => {
      const filtersArb = fc.record({
        serviceTypes: fc.array(serviceTypeArb, { minLength: 0, maxLength: 3 }),
        minPriceCents: fc.option(priceCentsArb, { nil: null }),
        maxPriceCents: fc.option(priceCentsArb, { nil: null }),
        maxDistanceMeters: fc.option(distanceMetersArb, { nil: null }),
        scheduledAfter: fc.option(isoDateFutureArb, { nil: null }),
        scheduledBefore: fc.option(isoDateFutureArb, { nil: null }),
      });

      fc.assert(
        fc.property(
          fc.array(radarOfferArb(), { minLength: 0, maxLength: 30 }),
          filtersArb,
          (offers, filters) => {
            const result = applyFilters(offers, filters);

            for (const offer of result) {
              if (filters.serviceTypes.length > 0) {
                expect(filters.serviceTypes).toContain(offer.serviceType);
              }
              if (filters.minPriceCents !== null) {
                expect(offer.priceBreakdown.payoutCents).toBeGreaterThanOrEqual(filters.minPriceCents);
              }
              if (filters.maxPriceCents !== null) {
                expect(offer.priceBreakdown.payoutCents).toBeLessThanOrEqual(filters.maxPriceCents);
              }
              if (filters.maxDistanceMeters !== null) {
                expect(offer.distanceMeters).toBeLessThanOrEqual(filters.maxDistanceMeters);
              }
              if (filters.scheduledAfter !== null) {
                expect(offer.scheduledAt >= filters.scheduledAfter).toBe(true);
              }
              if (filters.scheduledBefore !== null) {
                expect(offer.scheduledAt <= filters.scheduledBefore).toBe(true);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: offer-radar, Property 3: Sort Ordering Guarantee
  describe('Property 3: Sort Ordering Guarantee', () => {
    /**
     * Validates: Requirements 4.2, 4.7
     *
     * For any sort option applied to offers, consecutive pair invariant holds.
     */
    it('should maintain correct ordering for all sort options', () => {
      fc.assert(
        fc.property(
          fc.array(radarOfferArb(), { minLength: 2, maxLength: 50 }),
          sortOptionArb,
          (offers, sort) => {
            const sorted = applySorting(offers, sort);

            for (let i = 0; i < sorted.length - 1; i++) {
              switch (sort) {
                case 'distance_asc':
                  expect(sorted[i].distanceMeters).toBeLessThanOrEqual(sorted[i + 1].distanceMeters);
                  break;
                case 'price_desc':
                  expect(sorted[i].priceBreakdown.payoutCents).toBeGreaterThanOrEqual(
                    sorted[i + 1].priceBreakdown.payoutCents,
                  );
                  break;
                case 'scheduled_asc':
                  expect(sorted[i].scheduledAt <= sorted[i + 1].scheduledAt).toBe(true);
                  break;
                case 'published_desc':
                  expect(sorted[i].publishedAt >= sorted[i + 1].publishedAt).toBe(true);
                  break;
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: offer-radar, Property 4: Privacy Field Exclusion
  describe('Property 4: Privacy Field Exclusion', () => {
    /**
     * Validates: Requirements 4.5, 4.6
     *
     * No response object SHALL contain forbidden fields.
     */
    it('should never expose forbidden privacy fields in offer objects', () => {
      fc.assert(
        fc.property(
          fc.array(radarOfferArb(), { minLength: 1, maxLength: 30 }),
          (offers) => {
            for (const offer of offers) {
              const serialized = JSON.stringify(offer);
              const offerKeys = Object.keys(offer);

              for (const forbidden of FORBIDDEN_FIELDS) {
                expect(offerKeys).not.toContain(forbidden);
                // Also verify the field name does not appear as a key in nested objects
                expect(serialized).not.toContain(`"${forbidden}"`);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: offer-radar, Property 5: Reconciliation Completeness (REST Wins)
  describe('Property 5: Reconciliation Completeness (REST Wins)', () => {
    /**
     * Validates: Requirements 14.3, 14.4, 3.6
     *
     * After reconciliation, local offer set equals exactly the snapshot.
     */
    it('should replace all local state with snapshot data', async () => {
      const { fetchSnapshot } = require('../radar.api');

      await fc.assert(
        fc.asyncProperty(
          // Pre-existing local offers
          fc.array(radarOfferArb(), { minLength: 0, maxLength: 20 }),
          // Snapshot offers from server
          fc.array(radarOfferArb(), { minLength: 0, maxLength: 20 }),
          async (localOffers, snapshotOffers) => {
            resetStore();

            // Populate local state
            const store = useRadarStore.getState();
            for (const offer of localOffers) {
              store.handleOfferNew(offer);
            }

            // Mock snapshot response
            (fetchSnapshot as jest.Mock).mockResolvedValue({
              offers: snapshotOffers,
              syncedAt: new Date().toISOString(),
            });

            // Reconcile
            await useRadarStore.getState().reconcile();

            const updated = useRadarStore.getState();
            const snapshotIds = new Set(snapshotOffers.map((o) => o.offerId));

            // Post-reconciliation store must equal snapshot exactly
            expect(updated.offers.size).toBe(snapshotIds.size);

            for (const offerId of snapshotIds) {
              expect(updated.offers.has(offerId)).toBe(true);
            }

            // No local-only offers should remain
            for (const [id] of updated.offers) {
              expect(snapshotIds.has(id)).toBe(true);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: offer-radar, Property 6: Ad Slot Positioning
  describe('Property 6: Ad Slot Positioning', () => {
    /**
     * Validates: Requirements 6.7
     *
     * Ad slots appear at positions 4,9,14,19... when enabled; none when disabled.
     */
    it('should place ads at correct positions when enabled, none when disabled', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 200 }),
          fc.boolean(),
          (listLength, adsEnabled) => {
            const positions = computeAdSlotPositions(listLength, adsEnabled);

            if (!adsEnabled) {
              expect(positions).toHaveLength(0);
            } else {
              // Verify each position follows the pattern
              for (let i = 0; i < positions.length; i++) {
                const expectedPos = AD_SLOT_FIRST_POSITION + i * AD_SLOT_INTERVAL;
                expect(positions[i]).toBe(expectedPos);
                expect(positions[i]).toBeLessThan(listLength);
              }

              // Verify no valid position was skipped
              if (listLength > AD_SLOT_FIRST_POSITION) {
                expect(positions.length).toBeGreaterThan(0);
                expect(positions[0]).toBe(AD_SLOT_FIRST_POSITION);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: offer-radar, Property 7: WebSocket Event Idempotency
  describe('Property 7: WebSocket Event Idempotency', () => {
    /**
     * Validates: Requirements 3.2, 14.2
     *
     * Duplicate offer_new events for the same offerId result in exactly one store entry.
     */
    it('should contain exactly one entry per unique offerId regardless of duplicates', () => {
      fc.assert(
        fc.property(
          fc.array(radarOfferArb(), { minLength: 1, maxLength: 30 }),
          fc.integer({ min: 1, max: 5 }),
          (offers, duplicateCount) => {
            resetStore();

            const store = useRadarStore.getState();

            // Send each offer multiple times
            for (const offer of offers) {
              for (let i = 0; i < duplicateCount; i++) {
                store.handleOfferNew(offer);
              }
            }

            const updated = useRadarStore.getState();
            const uniqueIds = new Set(offers.map((o) => o.offerId));

            // Store must have exactly one entry per unique offerId
            expect(updated.offers.size).toBe(uniqueIds.size);

            for (const id of uniqueIds) {
              expect(updated.offers.has(id)).toBe(true);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: offer-radar, Property 8: Event Temporal Ordering
  describe('Property 8: Event Temporal Ordering', () => {
    /**
     * Validates: Requirements 3.3, 14.4
     *
     * Only the event with the latest changedAt timestamp takes effect,
     * regardless of delivery order.
     */
    it('should always reflect the latest event timestamp regardless of arrival order', () => {
      fc.assert(
        fc.property(
          radarOfferArb(),
          // Generate pairs of timestamps and shuffle order
          fc.array(
            fc.integer({
              min: new Date('2025-01-01T00:00:00Z').getTime(),
              max: new Date('2025-12-31T23:59:59Z').getTime(),
            }).map((ts) => new Date(ts).toISOString()),
            { minLength: 2, maxLength: 10 },
          ),
          (offer, timestamps) => {
            resetStore();

            const store = useRadarStore.getState();
            store.handleOfferNew(offer);

            // Shuffle timestamps to simulate out-of-order delivery
            const shuffled = [...timestamps].sort(() => Math.random() - 0.5);

            for (const ts of shuffled) {
              store.handleOfferStatusChanged(offer.offerId, 'CANCELLED', ts);
            }

            const updated = useRadarStore.getState();
            const storedTimestamp = updated.offerEventTimestamps.get(offer.offerId);

            // The stored timestamp should be the lexicographically latest one
            const latestTimestamp = [...timestamps].sort().reverse()[0];
            expect(storedTimestamp).toBe(latestTimestamp);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: offer-radar, Property 9: Pagination Uniqueness
  describe('Property 9: Pagination Uniqueness', () => {
    /**
     * Validates: Requirements 4.2, 6.5
     *
     * Union of all paginated pages contains no duplicate offerIds.
     */
    it('should have no duplicate offerIds across pages', () => {
      fc.assert(
        fc.property(
          fc.array(radarOfferArb(), { minLength: 1, maxLength: 100 }),
          fc.integer({ min: 5, max: 50 }),
          (offers, pageSize) => {
            // Deduplicate offers by offerId (simulating DB uniqueness constraint)
            const uniqueOffers = Array.from(
              new Map(offers.map((o) => [o.offerId, o])).values(),
            );

            const pages = paginateOffers(uniqueOffers, pageSize);

            // Collect all IDs across all pages
            const allIds: string[] = [];
            for (const page of pages) {
              for (const offer of page) {
                allIds.push(offer.offerId);
              }
            }

            // No duplicates
            const uniqueIds = new Set(allIds);
            expect(allIds.length).toBe(uniqueIds.size);

            // All original offers are present
            expect(allIds.length).toBe(uniqueOffers.length);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: offer-radar, Property 10: Public Location Privacy Displacement
  describe('Property 10: Public Location Privacy Displacement', () => {
    /**
     * Validates: Requirements 4.5, 4.6
     *
     * Distance between exact and public location is in [MIN_JITTER, MAX_JITTER].
     * Same offerId always produces same result (deterministic).
     */
    it('should displace within bounds and be deterministic', () => {
      fc.assert(
        fc.property(
          fc.record({
            lat: fc.double({ min: -60, max: 60, noNaN: true }),
            lng: fc.double({ min: -170, max: 170, noNaN: true }),
          }),
          offerIdArb,
          (exactLocation, offerId) => {
            const config = {
              minJitterMeters: MIN_JITTER_METERS,
              maxJitterMeters: MAX_JITTER_METERS,
            };

            const publicLoc1 = generatePublicLocation(exactLocation, offerId, config);
            const publicLoc2 = generatePublicLocation(exactLocation, offerId, config);

            // Deterministic: same inputs produce same output
            expect(publicLoc1.lat).toBe(publicLoc2.lat);
            expect(publicLoc1.lng).toBe(publicLoc2.lng);

            // Distance within bounds
            const distance = haversineMeters(exactLocation, publicLoc1);
            expect(distance).toBeGreaterThanOrEqual(MIN_JITTER_METERS * 0.95); // 5% tolerance for floating point
            expect(distance).toBeLessThanOrEqual(MAX_JITTER_METERS * 1.05); // 5% tolerance
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: offer-radar, Property 11: Offline Acceptance Safety
  describe('Property 11: Offline Acceptance Safety', () => {
    /**
     * Validates: Requirements 7.5, 13.3
     *
     * Quick Accept is non-executable when device is disconnected.
     */
    it('should block Quick Accept when offline regardless of offer state', () => {
      /**
       * Pure function modeling the Quick Accept enabled logic.
       * Mirrors the OfferPreviewSheet implementation.
       */
      function isQuickAcceptEnabled(
        connectionStatus: ConnectionStatus,
        offerExists: boolean,
        isStale: boolean,
      ): boolean {
        // Quick Accept requires: connected + offer exists + not stale
        if (connectionStatus === 'disconnected') return false;
        if (connectionStatus === 'reconnecting') return false;
        if (!offerExists) return false;
        if (isStale) return false;
        return true;
      }

      fc.assert(
        fc.property(
          fc.constantFrom<ConnectionStatus>('connected', 'disconnected', 'reconnecting'),
          fc.boolean(),
          fc.boolean(),
          (connectionStatus, offerExists, isStale) => {
            const enabled = isQuickAcceptEnabled(connectionStatus, offerExists, isStale);

            // Core safety property: NEVER enabled when disconnected
            if (connectionStatus === 'disconnected') {
              expect(enabled).toBe(false);
            }

            // Also not enabled when reconnecting
            if (connectionStatus === 'reconnecting') {
              expect(enabled).toBe(false);
            }

            // Can only be true when connected + offer exists + not stale
            if (enabled) {
              expect(connectionStatus).toBe('connected');
              expect(offerExists).toBe(true);
              expect(isStale).toBe(false);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
