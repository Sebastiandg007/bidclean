// @ts-nocheck
/**
 * AvailableOffersService unit tests.
 *
 * Tests: filter application, sort ordering, pagination math, urgency calculation,
 * privacy guarantee (no forbidden fields), visibility contract, and snapshot rate limiting.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import { AvailableOffersService } from '../available-offers.service';
import { AvailableOffersRepository } from '../available-offers.repository';
import { AvailableOffersQueryDto, AvailableOffersSortOption } from '../dto/available-offers-query.dto';
import { AvailableOfferRow } from '../dto/available-offers.types';
import { ServiceType } from '../../offers.types';

describe('AvailableOffersService', () => {
  let service: AvailableOffersService;
  let mockRepository: jest.Mocked<AvailableOffersRepository>;

  const cleanerId = 'cleaner-uuid-001';

  /** Factory for creating a valid AvailableOfferRow */
  function createOfferRow(overrides: Partial<AvailableOfferRow> = {}): AvailableOfferRow {
    const futureDate = new Date(Date.now() + 4 * 60 * 60 * 1000); // 4 hours from now
    return {
      offer_id: 'offer-uuid-123',
      property_name_snapshot: 'Sunny Apartment',
      property_type_snapshot: 'apartment',
      property_city_snapshot: 'Miami',
      property_cover_photo_snapshot: 'https://storage.bidclean.tech/photo.jpg',
      service_type: 'standard',
      description: 'Weekly cleaning',
      scheduled_at: futureDate,
      timezone: 'America/New_York',
      estimated_duration_minutes: 120,
      offered_price_cents: 8000,
      cleaner_commission_cents: 240,
      cleaner_payout_cents: 7760,
      currency: 'USD',
      published_at: new Date('2024-01-15T10:00:00Z'),
      distance_meters: 3500,
      is_urgent: false,
      public_lat: 25.7617,
      public_lng: -80.1918,
      ...overrides,
    };
  }

  beforeEach(() => {
    mockRepository = {
      findAvailableOffers: jest.fn(),
      findAvailableOffersSnapshot: jest.fn(),
    } as unknown as jest.Mocked<AvailableOffersRepository>;

    service = new AvailableOffersService(mockRepository);
  });

  describe('getAvailableOffers', () => {
    describe('filter application', () => {
      it('should pass serviceType filter to repository', async () => {
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [], total: 0 });
        const queryDto = new AvailableOffersQueryDto();
        queryDto.serviceType = [ServiceType.DEEP, ServiceType.STANDARD];
        queryDto.sort = AvailableOffersSortOption.DISTANCE_ASC;
        queryDto.page = 1;
        queryDto.limit = 20;

        await service.getAvailableOffers(cleanerId, queryDto);

        expect(mockRepository.findAvailableOffers).toHaveBeenCalledWith(
          expect.objectContaining({
            cleanerId,
            serviceTypes: [ServiceType.DEEP, ServiceType.STANDARD],
          }),
        );
      });

      it('should pass minPriceCents filter to repository', async () => {
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [], total: 0 });
        const queryDto = new AvailableOffersQueryDto();
        queryDto.minPriceCents = 5000;
        queryDto.sort = AvailableOffersSortOption.DISTANCE_ASC;
        queryDto.page = 1;
        queryDto.limit = 20;

        await service.getAvailableOffers(cleanerId, queryDto);

        expect(mockRepository.findAvailableOffers).toHaveBeenCalledWith(
          expect.objectContaining({ minPriceCents: 5000 }),
        );
      });

      it('should pass maxPriceCents filter to repository', async () => {
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [], total: 0 });
        const queryDto = new AvailableOffersQueryDto();
        queryDto.maxPriceCents = 15000;
        queryDto.sort = AvailableOffersSortOption.DISTANCE_ASC;
        queryDto.page = 1;
        queryDto.limit = 20;

        await service.getAvailableOffers(cleanerId, queryDto);

        expect(mockRepository.findAvailableOffers).toHaveBeenCalledWith(
          expect.objectContaining({ maxPriceCents: 15000 }),
        );
      });

      it('should pass maxDistanceMeters filter to repository', async () => {
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [], total: 0 });
        const queryDto = new AvailableOffersQueryDto();
        queryDto.maxDistanceMeters = 5000;
        queryDto.sort = AvailableOffersSortOption.DISTANCE_ASC;
        queryDto.page = 1;
        queryDto.limit = 20;

        await service.getAvailableOffers(cleanerId, queryDto);

        expect(mockRepository.findAvailableOffers).toHaveBeenCalledWith(
          expect.objectContaining({ maxDistanceMeters: 5000 }),
        );
      });

      it('should pass scheduledBefore filter to repository', async () => {
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [], total: 0 });
        const queryDto = new AvailableOffersQueryDto();
        queryDto.scheduledBefore = '2024-12-31T23:59:59Z';
        queryDto.sort = AvailableOffersSortOption.DISTANCE_ASC;
        queryDto.page = 1;
        queryDto.limit = 20;

        await service.getAvailableOffers(cleanerId, queryDto);

        expect(mockRepository.findAvailableOffers).toHaveBeenCalledWith(
          expect.objectContaining({ scheduledBefore: '2024-12-31T23:59:59Z' }),
        );
      });

      it('should pass scheduledAfter filter to repository', async () => {
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [], total: 0 });
        const queryDto = new AvailableOffersQueryDto();
        queryDto.scheduledAfter = '2024-06-01T00:00:00Z';
        queryDto.sort = AvailableOffersSortOption.DISTANCE_ASC;
        queryDto.page = 1;
        queryDto.limit = 20;

        await service.getAvailableOffers(cleanerId, queryDto);

        expect(mockRepository.findAvailableOffers).toHaveBeenCalledWith(
          expect.objectContaining({ scheduledAfter: '2024-06-01T00:00:00Z' }),
        );
      });

      it('should pass all filters combined to repository', async () => {
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [], total: 0 });
        const queryDto = new AvailableOffersQueryDto();
        queryDto.serviceType = [ServiceType.DEEP];
        queryDto.minPriceCents = 3000;
        queryDto.maxPriceCents = 12000;
        queryDto.maxDistanceMeters = 8000;
        queryDto.scheduledBefore = '2024-12-31T23:59:59Z';
        queryDto.scheduledAfter = '2024-06-01T00:00:00Z';
        queryDto.sort = AvailableOffersSortOption.PRICE_DESC;
        queryDto.page = 2;
        queryDto.limit = 10;

        await service.getAvailableOffers(cleanerId, queryDto);

        expect(mockRepository.findAvailableOffers).toHaveBeenCalledWith({
          cleanerId,
          serviceTypes: [ServiceType.DEEP],
          minPriceCents: 3000,
          maxPriceCents: 12000,
          maxDistanceMeters: 8000,
          scheduledBefore: '2024-12-31T23:59:59Z',
          scheduledAfter: '2024-06-01T00:00:00Z',
          sort: AvailableOffersSortOption.PRICE_DESC,
          page: 2,
          limit: 10,
        });
      });

      it('should not include undefined filters in repository call', async () => {
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [], total: 0 });
        const queryDto = new AvailableOffersQueryDto();
        queryDto.sort = AvailableOffersSortOption.DISTANCE_ASC;
        queryDto.page = 1;
        queryDto.limit = 20;

        await service.getAvailableOffers(cleanerId, queryDto);

        const passedFilters = mockRepository.findAvailableOffers.mock.calls[0][0];
        expect(passedFilters.serviceTypes).toBeUndefined();
        expect(passedFilters.minPriceCents).toBeUndefined();
        expect(passedFilters.maxPriceCents).toBeUndefined();
        expect(passedFilters.maxDistanceMeters).toBeUndefined();
        expect(passedFilters.scheduledBefore).toBeUndefined();
        expect(passedFilters.scheduledAfter).toBeUndefined();
      });
    });

    describe('sort ordering', () => {
      it('should pass distance_asc sort to repository', async () => {
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [], total: 0 });
        const queryDto = new AvailableOffersQueryDto();
        queryDto.sort = AvailableOffersSortOption.DISTANCE_ASC;
        queryDto.page = 1;
        queryDto.limit = 20;

        await service.getAvailableOffers(cleanerId, queryDto);

        expect(mockRepository.findAvailableOffers).toHaveBeenCalledWith(
          expect.objectContaining({ sort: AvailableOffersSortOption.DISTANCE_ASC }),
        );
      });

      it('should pass price_desc sort to repository', async () => {
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [], total: 0 });
        const queryDto = new AvailableOffersQueryDto();
        queryDto.sort = AvailableOffersSortOption.PRICE_DESC;
        queryDto.page = 1;
        queryDto.limit = 20;

        await service.getAvailableOffers(cleanerId, queryDto);

        expect(mockRepository.findAvailableOffers).toHaveBeenCalledWith(
          expect.objectContaining({ sort: AvailableOffersSortOption.PRICE_DESC }),
        );
      });

      it('should pass scheduled_asc sort to repository', async () => {
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [], total: 0 });
        const queryDto = new AvailableOffersQueryDto();
        queryDto.sort = AvailableOffersSortOption.SCHEDULED_ASC;
        queryDto.page = 1;
        queryDto.limit = 20;

        await service.getAvailableOffers(cleanerId, queryDto);

        expect(mockRepository.findAvailableOffers).toHaveBeenCalledWith(
          expect.objectContaining({ sort: AvailableOffersSortOption.SCHEDULED_ASC }),
        );
      });

      it('should pass published_desc sort to repository', async () => {
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [], total: 0 });
        const queryDto = new AvailableOffersQueryDto();
        queryDto.sort = AvailableOffersSortOption.PUBLISHED_DESC;
        queryDto.page = 1;
        queryDto.limit = 20;

        await service.getAvailableOffers(cleanerId, queryDto);

        expect(mockRepository.findAvailableOffers).toHaveBeenCalledWith(
          expect.objectContaining({ sort: AvailableOffersSortOption.PUBLISHED_DESC }),
        );
      });
    });

    describe('pagination math', () => {
      it('should compute totalPages correctly when total is evenly divisible', async () => {
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [], total: 60 });
        const queryDto = new AvailableOffersQueryDto();
        queryDto.sort = AvailableOffersSortOption.DISTANCE_ASC;
        queryDto.page = 1;
        queryDto.limit = 20;

        const result = await service.getAvailableOffers(cleanerId, queryDto);

        expect(result.pagination.totalPages).toBe(3);
        expect(result.pagination.total).toBe(60);
        expect(result.pagination.page).toBe(1);
        expect(result.pagination.limit).toBe(20);
      });

      it('should compute totalPages correctly when total is not evenly divisible', async () => {
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [], total: 55 });
        const queryDto = new AvailableOffersQueryDto();
        queryDto.sort = AvailableOffersSortOption.DISTANCE_ASC;
        queryDto.page = 1;
        queryDto.limit = 20;

        const result = await service.getAvailableOffers(cleanerId, queryDto);

        expect(result.pagination.totalPages).toBe(3);
      });

      it('should return totalPages 0 when no offers found', async () => {
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [], total: 0 });
        const queryDto = new AvailableOffersQueryDto();
        queryDto.sort = AvailableOffersSortOption.DISTANCE_ASC;
        queryDto.page = 1;
        queryDto.limit = 20;

        const result = await service.getAvailableOffers(cleanerId, queryDto);

        expect(result.pagination.totalPages).toBe(0);
        expect(result.pagination.total).toBe(0);
      });

      it('should return totalPages 1 when total equals limit', async () => {
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [], total: 20 });
        const queryDto = new AvailableOffersQueryDto();
        queryDto.sort = AvailableOffersSortOption.DISTANCE_ASC;
        queryDto.page = 1;
        queryDto.limit = 20;

        const result = await service.getAvailableOffers(cleanerId, queryDto);

        expect(result.pagination.totalPages).toBe(1);
      });

      it('should return totalPages 1 when total is 1', async () => {
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [], total: 1 });
        const queryDto = new AvailableOffersQueryDto();
        queryDto.sort = AvailableOffersSortOption.DISTANCE_ASC;
        queryDto.page = 1;
        queryDto.limit = 50;

        const result = await service.getAvailableOffers(cleanerId, queryDto);

        expect(result.pagination.totalPages).toBe(1);
      });

      it('should pass page and limit correctly to repository', async () => {
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [], total: 0 });
        const queryDto = new AvailableOffersQueryDto();
        queryDto.sort = AvailableOffersSortOption.DISTANCE_ASC;
        queryDto.page = 3;
        queryDto.limit = 10;

        await service.getAvailableOffers(cleanerId, queryDto);

        expect(mockRepository.findAvailableOffers).toHaveBeenCalledWith(
          expect.objectContaining({ page: 3, limit: 10 }),
        );
      });
    });

    describe('urgency calculation', () => {
      it('should mark offer as urgent when scheduled within 2 hours', async () => {
        const scheduledSoon = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
        const row = createOfferRow({ scheduled_at: scheduledSoon });
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [row], total: 1 });

        const queryDto = new AvailableOffersQueryDto();
        queryDto.sort = AvailableOffersSortOption.DISTANCE_ASC;
        queryDto.page = 1;
        queryDto.limit = 20;

        const result = await service.getAvailableOffers(cleanerId, queryDto);

        expect(result.items[0].isUrgent).toBe(true);
      });

      it('should mark offer as urgent when scheduled exactly at 2-hour boundary', async () => {
        const exactlyTwoHours = new Date(Date.now() + 2 * 60 * 60 * 1000);
        const row = createOfferRow({ scheduled_at: exactlyTwoHours });
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [row], total: 1 });

        const queryDto = new AvailableOffersQueryDto();
        queryDto.sort = AvailableOffersSortOption.DISTANCE_ASC;
        queryDto.page = 1;
        queryDto.limit = 20;

        const result = await service.getAvailableOffers(cleanerId, queryDto);

        expect(result.items[0].isUrgent).toBe(true);
      });

      it('should mark offer as not urgent when scheduled beyond 2 hours', async () => {
        const scheduledLater = new Date(Date.now() + 5 * 60 * 60 * 1000); // 5 hours from now
        const row = createOfferRow({ scheduled_at: scheduledLater });
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [row], total: 1 });

        const queryDto = new AvailableOffersQueryDto();
        queryDto.sort = AvailableOffersSortOption.DISTANCE_ASC;
        queryDto.page = 1;
        queryDto.limit = 20;

        const result = await service.getAvailableOffers(cleanerId, queryDto);

        expect(result.items[0].isUrgent).toBe(false);
      });
    });

    describe('response mapping', () => {
      it('should correctly map database row to response DTO', async () => {
        const row = createOfferRow();
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [row], total: 1 });

        const queryDto = new AvailableOffersQueryDto();
        queryDto.sort = AvailableOffersSortOption.DISTANCE_ASC;
        queryDto.page = 1;
        queryDto.limit = 20;

        const result = await service.getAvailableOffers(cleanerId, queryDto);
        const offer = result.items[0];

        expect(offer.offerId).toBe(row.offer_id);
        expect(offer.propertySnapshot.name).toBe(row.property_name_snapshot);
        expect(offer.propertySnapshot.type).toBe(row.property_type_snapshot);
        expect(offer.propertySnapshot.city).toBe(row.property_city_snapshot);
        expect(offer.propertySnapshot.coverPhotoUrl).toBe(row.property_cover_photo_snapshot);
        expect(offer.serviceType).toBe(row.service_type);
        expect(offer.description).toBe(row.description);
        expect(offer.scheduledAt).toBe(row.scheduled_at.toISOString());
        expect(offer.timezone).toBe(row.timezone);
        expect(offer.estimatedDurationMinutes).toBe(row.estimated_duration_minutes);
        expect(offer.priceBreakdown.offeredPriceCents).toBe(row.offered_price_cents);
        expect(offer.priceBreakdown.commissionCents).toBe(row.cleaner_commission_cents);
        expect(offer.priceBreakdown.payoutCents).toBe(row.cleaner_payout_cents);
        expect(offer.priceBreakdown.currency).toBe(row.currency);
        expect(offer.distanceMeters).toBe(row.distance_meters);
        expect(offer.publishedAt).toBe(row.published_at.toISOString());
        expect(offer.publicLocation.lat).toBe(row.public_lat);
        expect(offer.publicLocation.lng).toBe(row.public_lng);
      });

      it('should handle null description', async () => {
        const row = createOfferRow({ description: null });
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [row], total: 1 });

        const queryDto = new AvailableOffersQueryDto();
        queryDto.sort = AvailableOffersSortOption.DISTANCE_ASC;
        queryDto.page = 1;
        queryDto.limit = 20;

        const result = await service.getAvailableOffers(cleanerId, queryDto);

        expect(result.items[0].description).toBeNull();
      });

      it('should handle null coverPhotoUrl', async () => {
        const row = createOfferRow({ property_cover_photo_snapshot: null });
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [row], total: 1 });

        const queryDto = new AvailableOffersQueryDto();
        queryDto.sort = AvailableOffersSortOption.DISTANCE_ASC;
        queryDto.page = 1;
        queryDto.limit = 20;

        const result = await service.getAvailableOffers(cleanerId, queryDto);

        expect(result.items[0].propertySnapshot.coverPhotoUrl).toBeNull();
      });
    });

    describe('privacy (forbidden fields exclusion)', () => {
      it('should not include address_street in response', async () => {
        const row = createOfferRow();
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [row], total: 1 });

        const queryDto = new AvailableOffersQueryDto();
        queryDto.sort = AvailableOffersSortOption.DISTANCE_ASC;
        queryDto.page = 1;
        queryDto.limit = 20;

        const result = await service.getAvailableOffers(cleanerId, queryDto);
        const serialized = JSON.stringify(result);

        expect(serialized).not.toContain('address_street');
        expect(serialized).not.toContain('address_state');
        expect(serialized).not.toContain('address_postal_code');
        expect(serialized).not.toContain('formatted_address');
        expect(serialized).not.toContain('access_instructions');
        expect(serialized).not.toContain('location_source');
      });

      it('should only expose publicLocation (approximate), not exact coordinates', async () => {
        const row = createOfferRow();
        mockRepository.findAvailableOffers.mockResolvedValue({ rows: [row], total: 1 });

        const queryDto = new AvailableOffersQueryDto();
        queryDto.sort = AvailableOffersSortOption.DISTANCE_ASC;
        queryDto.page = 1;
        queryDto.limit = 20;

        const result = await service.getAvailableOffers(cleanerId, queryDto);
        const offer = result.items[0];

        // Only public location fields should be present
        expect(offer.publicLocation).toBeDefined();
        expect(offer.publicLocation.lat).toBe(row.public_lat);
        expect(offer.publicLocation.lng).toBe(row.public_lng);

        // Ensure no exact location field leaks
        const offerKeys = Object.keys(offer);
        expect(offerKeys).not.toContain('location');
        expect(offerKeys).not.toContain('exactLocation');
        expect(offerKeys).not.toContain('address');
      });
    });

    describe('multiple offers', () => {
      it('should map multiple rows to response DTOs', async () => {
        const row1 = createOfferRow({ offer_id: 'offer-1', distance_meters: 1000 });
        const row2 = createOfferRow({ offer_id: 'offer-2', distance_meters: 2000 });
        const row3 = createOfferRow({ offer_id: 'offer-3', distance_meters: 3000 });
        mockRepository.findAvailableOffers.mockResolvedValue({
          rows: [row1, row2, row3],
          total: 3,
        });

        const queryDto = new AvailableOffersQueryDto();
        queryDto.sort = AvailableOffersSortOption.DISTANCE_ASC;
        queryDto.page = 1;
        queryDto.limit = 20;

        const result = await service.getAvailableOffers(cleanerId, queryDto);

        expect(result.items).toHaveLength(3);
        expect(result.items[0].offerId).toBe('offer-1');
        expect(result.items[1].offerId).toBe('offer-2');
        expect(result.items[2].offerId).toBe('offer-3');
      });
    });
  });

  describe('getAvailableOffersSnapshot', () => {
    it('should return all offers without pagination', async () => {
      const rows = [
        createOfferRow({ offer_id: 'offer-1' }),
        createOfferRow({ offer_id: 'offer-2' }),
      ];
      mockRepository.findAvailableOffersSnapshot.mockResolvedValue({ rows });

      const result = await service.getAvailableOffersSnapshot(cleanerId);

      expect(result.offers).toHaveLength(2);
      expect(result.offers[0].offerId).toBe('offer-1');
      expect(result.offers[1].offerId).toBe('offer-2');
    });

    it('should include syncedAt timestamp in response', async () => {
      mockRepository.findAvailableOffersSnapshot.mockResolvedValue({ rows: [] });

      const before = new Date().toISOString();
      const result = await service.getAvailableOffersSnapshot(cleanerId);
      const after = new Date().toISOString();

      expect(result.syncedAt).toBeDefined();
      expect(result.syncedAt >= before).toBe(true);
      expect(result.syncedAt <= after).toBe(true);
    });

    it('should call repository with the cleanerId', async () => {
      mockRepository.findAvailableOffersSnapshot.mockResolvedValue({ rows: [] });

      await service.getAvailableOffersSnapshot(cleanerId);

      expect(mockRepository.findAvailableOffersSnapshot).toHaveBeenCalledWith(cleanerId);
    });

    describe('rate limiting', () => {
      it('should throw 429 when called more than once within 30 seconds', async () => {
        mockRepository.findAvailableOffersSnapshot.mockResolvedValue({ rows: [] });

        // First call should succeed
        await service.getAvailableOffersSnapshot(cleanerId);

        // Second call within rate limit window should throw
        await expect(
          service.getAvailableOffersSnapshot(cleanerId),
        ).rejects.toThrow(HttpException);

        try {
          await service.getAvailableOffersSnapshot(cleanerId);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        }
      });

      it('should rate limit independently per Cleaner', async () => {
        mockRepository.findAvailableOffersSnapshot.mockResolvedValue({ rows: [] });
        const otherCleaner = 'cleaner-uuid-002';

        // First call for cleaner 1
        await service.getAvailableOffersSnapshot(cleanerId);

        // First call for cleaner 2 should NOT be rate limited
        await expect(
          service.getAvailableOffersSnapshot(otherCleaner),
        ).resolves.toBeDefined();
      });

      it('should include retryAfterSeconds in 429 response body', async () => {
        mockRepository.findAvailableOffersSnapshot.mockResolvedValue({ rows: [] });

        await service.getAvailableOffersSnapshot(cleanerId);

        try {
          await service.getAvailableOffersSnapshot(cleanerId);
        } catch (error) {
          const response = (error as HttpException).getResponse() as Record<string, unknown>;
          expect(response.retryAfterSeconds).toBeDefined();
          expect(typeof response.retryAfterSeconds).toBe('number');
          expect(response.retryAfterSeconds).toBeGreaterThan(0);
          expect(response.retryAfterSeconds).toBeLessThanOrEqual(30);
        }
      });
    });
  });
});
