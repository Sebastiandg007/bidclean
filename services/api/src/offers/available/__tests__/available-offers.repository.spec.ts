/**
 * AvailableOffersRepository unit tests.
 *
 * Tests: SQL query builder for each filter, null-filter handling,
 * sort clause generation, pagination offset calculation.
 * Mocks DataSource.query.
 */
import { AvailableOffersRepository } from '../available-offers.repository';
import { AvailableOffersSortOption } from '../dto/available-offers-query.dto';
import { AvailableOffersFilters } from '../dto/available-offers.types';
import { ServiceType } from '../../offers.types';

describe('AvailableOffersRepository', () => {
  let repository: AvailableOffersRepository;
  let mockDataSource: { query: jest.Mock };

  const cleanerId = 'cleaner-uuid-001';

  /** Creates minimal valid filters */
  function createFilters(overrides: Partial<AvailableOffersFilters> = {}): AvailableOffersFilters {
    return {
      cleanerId,
      sort: AvailableOffersSortOption.DISTANCE_ASC,
      page: 1,
      limit: 20,
      ...overrides,
    };
  }

  beforeEach(() => {
    mockDataSource = {
      query: jest.fn().mockResolvedValue([]),
    };

    repository = new AvailableOffersRepository(mockDataSource as any);
  });

  describe('findAvailableOffers', () => {
    describe('core visibility contract', () => {
      it('should always include cleaner_id filter in WHERE clause', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters();

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        expect(dataQuery).toContain('od.cleaner_id = $1');
      });

      it('should always include delivery_status = SENT condition', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters();

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        expect(dataQuery).toContain("od.delivery_status = 'SENT'");
      });

      it('should always include state = ACTIVE condition', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters();

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        expect(dataQuery).toContain("o.state = 'ACTIVE'");
      });

      it('should always include scheduled_at > NOW() condition', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters();

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        expect(dataQuery).toContain('o.scheduled_at > NOW()');
      });

      it('should pass cleanerId as the first parameter', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters();

        await repository.findAvailableOffers(filters);

        const dataParams = mockDataSource.query.mock.calls[0][1] as unknown[];
        expect(dataParams[0]).toBe(cleanerId);
      });
    });

    describe('serviceTypes filter', () => {
      it('should add service_type = ANY($N) when serviceTypes provided', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters({
          serviceTypes: [ServiceType.DEEP, ServiceType.STANDARD],
        });

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        expect(dataQuery).toContain('o.service_type = ANY($');

        const dataParams = mockDataSource.query.mock.calls[0][1] as unknown[];
        expect(dataParams).toContain(filters.serviceTypes);
      });

      it('should NOT add service_type filter when serviceTypes is undefined', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters({ serviceTypes: undefined });

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        expect(dataQuery).not.toContain('o.service_type = ANY');
      });

      it('should NOT add service_type filter when serviceTypes is empty array', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters({ serviceTypes: [] });

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        expect(dataQuery).not.toContain('o.service_type = ANY');
      });
    });

    describe('minPriceCents filter', () => {
      it('should add cleaner_payout_cents >= $N when minPriceCents provided', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters({ minPriceCents: 5000 });

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        expect(dataQuery).toContain('o.cleaner_payout_cents >= $');

        const dataParams = mockDataSource.query.mock.calls[0][1] as unknown[];
        expect(dataParams).toContain(5000);
      });

      it('should NOT add minPriceCents filter when undefined', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters({ minPriceCents: undefined });

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        expect(dataQuery).not.toContain('o.cleaner_payout_cents >=');
      });
    });

    describe('maxPriceCents filter', () => {
      it('should add cleaner_payout_cents <= $N when maxPriceCents provided', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters({ maxPriceCents: 15000 });

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        expect(dataQuery).toContain('o.cleaner_payout_cents <= $');

        const dataParams = mockDataSource.query.mock.calls[0][1] as unknown[];
        expect(dataParams).toContain(15000);
      });

      it('should NOT add maxPriceCents filter when undefined', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters({ maxPriceCents: undefined });

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        expect(dataQuery).not.toContain('o.cleaner_payout_cents <=');
      });
    });

    describe('maxDistanceMeters filter', () => {
      it('should add ST_DWithin condition when maxDistanceMeters provided', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters({ maxDistanceMeters: 8000 });

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        expect(dataQuery).toContain('ST_DWithin(');

        const dataParams = mockDataSource.query.mock.calls[0][1] as unknown[];
        expect(dataParams).toContain(8000);
      });

      it('should NOT add ST_DWithin when maxDistanceMeters is undefined', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters({ maxDistanceMeters: undefined });

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        expect(dataQuery).not.toContain('ST_DWithin');
      });
    });

    describe('scheduledBefore filter', () => {
      it('should add scheduled_at <= $N when scheduledBefore provided', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters({ scheduledBefore: '2024-12-31T23:59:59Z' });

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        expect(dataQuery).toContain('o.scheduled_at <= $');

        const dataParams = mockDataSource.query.mock.calls[0][1] as unknown[];
        expect(dataParams).toContain('2024-12-31T23:59:59Z');
      });

      it('should NOT add scheduledBefore filter when undefined', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters({ scheduledBefore: undefined });

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        // Should not have a secondary scheduled_at <= (only the core scheduled_at > NOW())
        const matches = dataQuery.match(/o\.scheduled_at <= \$/g);
        expect(matches).toBeNull();
      });
    });

    describe('scheduledAfter filter', () => {
      it('should add scheduled_at >= $N when scheduledAfter provided', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters({ scheduledAfter: '2024-06-01T00:00:00Z' });

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        expect(dataQuery).toContain('o.scheduled_at >= $');

        const dataParams = mockDataSource.query.mock.calls[0][1] as unknown[];
        expect(dataParams).toContain('2024-06-01T00:00:00Z');
      });

      it('should NOT add scheduledAfter filter when undefined', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters({ scheduledAfter: undefined });

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        const matches = dataQuery.match(/o\.scheduled_at >= \$/g);
        expect(matches).toBeNull();
      });
    });

    describe('sort clause generation', () => {
      it('should ORDER BY distance_meters ASC for DISTANCE_ASC sort', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters({ sort: AvailableOffersSortOption.DISTANCE_ASC });

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        expect(dataQuery).toContain('ORDER BY distance_meters ASC');
      });

      it('should ORDER BY cleaner_payout_cents DESC for PRICE_DESC sort', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters({ sort: AvailableOffersSortOption.PRICE_DESC });

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        expect(dataQuery).toContain('ORDER BY o.cleaner_payout_cents DESC');
      });

      it('should ORDER BY scheduled_at ASC for SCHEDULED_ASC sort', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters({ sort: AvailableOffersSortOption.SCHEDULED_ASC });

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        expect(dataQuery).toContain('ORDER BY o.scheduled_at ASC');
      });

      it('should ORDER BY published_at DESC for PUBLISHED_DESC sort', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters({ sort: AvailableOffersSortOption.PUBLISHED_DESC });

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        expect(dataQuery).toContain('ORDER BY o.published_at DESC');
      });
    });

    describe('pagination', () => {
      it('should calculate offset = 0 for page 1', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters({ page: 1, limit: 20 });

        await repository.findAvailableOffers(filters);

        const dataParams = mockDataSource.query.mock.calls[0][1] as unknown[];
        // LIMIT and OFFSET are the last two params
        const offset = dataParams[dataParams.length - 1];
        const limit = dataParams[dataParams.length - 2];
        expect(limit).toBe(20);
        expect(offset).toBe(0);
      });

      it('should calculate offset = 20 for page 2 with limit 20', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters({ page: 2, limit: 20 });

        await repository.findAvailableOffers(filters);

        const dataParams = mockDataSource.query.mock.calls[0][1] as unknown[];
        const offset = dataParams[dataParams.length - 1];
        expect(offset).toBe(20);
      });

      it('should calculate offset = 40 for page 3 with limit 20', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters({ page: 3, limit: 20 });

        await repository.findAvailableOffers(filters);

        const dataParams = mockDataSource.query.mock.calls[0][1] as unknown[];
        const offset = dataParams[dataParams.length - 1];
        expect(offset).toBe(40);
      });

      it('should calculate offset = 150 for page 4 with limit 50', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters({ page: 4, limit: 50 });

        await repository.findAvailableOffers(filters);

        const dataParams = mockDataSource.query.mock.calls[0][1] as unknown[];
        const offset = dataParams[dataParams.length - 1];
        expect(offset).toBe(150);
      });

      it('should include LIMIT in the query', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters({ limit: 10 });

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        expect(dataQuery).toContain('LIMIT');
      });

      it('should include OFFSET in the query', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters();

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        expect(dataQuery).toContain('OFFSET');
      });
    });

    describe('count query', () => {
      it('should execute count query in parallel with data query', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters();

        await repository.findAvailableOffers(filters);

        // Both data query and count query should be executed
        expect(mockDataSource.query).toHaveBeenCalledTimes(2);
      });

      it('should use same WHERE clause for count query (no LIMIT/OFFSET)', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters({ minPriceCents: 5000 });

        await repository.findAvailableOffers(filters);

        const countQuery = mockDataSource.query.mock.calls[1][0] as string;
        expect(countQuery).toContain('SELECT COUNT(*)::integer AS total');
        expect(countQuery).toContain('o.cleaner_payout_cents >= $');
        expect(countQuery).not.toContain('LIMIT');
        expect(countQuery).not.toContain('OFFSET');
      });

      it('should return total from count query', async () => {
        mockDataSource.query
          .mockResolvedValueOnce([]) // data query
          .mockResolvedValueOnce([{ total: 42 }]); // count query

        const filters = createFilters();
        const result = await repository.findAvailableOffers(filters);

        expect(result.total).toBe(42);
      });

      it('should return total 0 when count query returns empty', async () => {
        mockDataSource.query
          .mockResolvedValueOnce([]) // data query
          .mockResolvedValueOnce([]); // count query (empty)

        const filters = createFilters();
        const result = await repository.findAvailableOffers(filters);

        expect(result.total).toBe(0);
      });
    });

    describe('query structure', () => {
      it('should select all required columns', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters();

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        expect(dataQuery).toContain('o.id AS offer_id');
        expect(dataQuery).toContain('o.property_name_snapshot');
        expect(dataQuery).toContain('o.property_type_snapshot');
        expect(dataQuery).toContain('o.property_city_snapshot');
        expect(dataQuery).toContain('o.property_cover_photo_snapshot');
        expect(dataQuery).toContain('o.service_type');
        expect(dataQuery).toContain('o.description');
        expect(dataQuery).toContain('o.scheduled_at');
        expect(dataQuery).toContain('o.timezone');
        expect(dataQuery).toContain('o.estimated_duration_minutes');
        expect(dataQuery).toContain('o.offered_price_cents');
        expect(dataQuery).toContain('o.cleaner_commission_cents');
        expect(dataQuery).toContain('o.cleaner_payout_cents');
        expect(dataQuery).toContain('o.currency');
        expect(dataQuery).toContain('o.published_at');
        expect(dataQuery).toContain('ST_Distance(');
        expect(dataQuery).toContain('distance_meters');
        expect(dataQuery).toContain('is_urgent');
        expect(dataQuery).toContain('public_lat');
        expect(dataQuery).toContain('public_lng');
      });

      it('should join offers with offer_deliveries', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters();

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        expect(dataQuery).toContain('INNER JOIN offer_deliveries od ON od.offer_id = o.id');
      });

      it('should join with cleaner_profiles for distance calculation', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters();

        await repository.findAvailableOffers(filters);

        const dataQuery = mockDataSource.query.mock.calls[0][0] as string;
        expect(dataQuery).toContain('INNER JOIN cleaner_profiles cp ON cp.user_id = od.cleaner_id');
      });
    });

    describe('parameter indexing', () => {
      it('should use sequential parameter placeholders with all filters', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters({
          serviceTypes: [ServiceType.DEEP],
          minPriceCents: 3000,
          maxPriceCents: 15000,
          maxDistanceMeters: 5000,
          scheduledBefore: '2024-12-31T23:59:59Z',
          scheduledAfter: '2024-01-01T00:00:00Z',
        });

        await repository.findAvailableOffers(filters);

        const dataParams = mockDataSource.query.mock.calls[0][1] as unknown[];
        // cleanerId + 6 filters + limit + offset = 9 params
        expect(dataParams).toHaveLength(9);
        expect(dataParams[0]).toBe(cleanerId);
        expect(dataParams[1]).toEqual([ServiceType.DEEP]);
        expect(dataParams[2]).toBe(3000);
        expect(dataParams[3]).toBe(15000);
        expect(dataParams[4]).toBe(5000);
        expect(dataParams[5]).toBe('2024-12-31T23:59:59Z');
        expect(dataParams[6]).toBe('2024-01-01T00:00:00Z');
        expect(dataParams[7]).toBe(20); // limit
        expect(dataParams[8]).toBe(0);  // offset (page 1)
      });

      it('should only include cleanerId + limit + offset when no optional filters', async () => {
        mockDataSource.query.mockResolvedValue([]);
        const filters = createFilters();

        await repository.findAvailableOffers(filters);

        const dataParams = mockDataSource.query.mock.calls[0][1] as unknown[];
        // cleanerId + limit + offset = 3 params
        expect(dataParams).toHaveLength(3);
        expect(dataParams[0]).toBe(cleanerId);
        expect(dataParams[1]).toBe(20); // limit
        expect(dataParams[2]).toBe(0);  // offset
      });
    });
  });

  describe('findAvailableOffersSnapshot', () => {
    it('should query with cleanerId parameter only', async () => {
      mockDataSource.query.mockResolvedValue([]);

      await repository.findAvailableOffersSnapshot(cleanerId);

      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.any(String),
        [cleanerId],
      );
    });

    it('should enforce visibility contract in snapshot query', async () => {
      mockDataSource.query.mockResolvedValue([]);

      await repository.findAvailableOffersSnapshot(cleanerId);

      const query = mockDataSource.query.mock.calls[0][0] as string;
      expect(query).toContain("od.delivery_status = 'SENT'");
      expect(query).toContain("o.state = 'ACTIVE'");
      expect(query).toContain('o.scheduled_at > NOW()');
    });

    it('should NOT include LIMIT or OFFSET in snapshot query', async () => {
      mockDataSource.query.mockResolvedValue([]);

      await repository.findAvailableOffersSnapshot(cleanerId);

      const query = mockDataSource.query.mock.calls[0][0] as string;
      expect(query).not.toContain('LIMIT');
      expect(query).not.toContain('OFFSET');
    });

    it('should ORDER BY distance ASC by default', async () => {
      mockDataSource.query.mockResolvedValue([]);

      await repository.findAvailableOffersSnapshot(cleanerId);

      const query = mockDataSource.query.mock.calls[0][0] as string;
      expect(query).toContain('ORDER BY');
      expect(query).toContain('ASC');
    });

    it('should return rows from the query', async () => {
      const mockRows = [{ offer_id: 'offer-1' }, { offer_id: 'offer-2' }];
      mockDataSource.query.mockResolvedValue(mockRows);

      const result = await repository.findAvailableOffersSnapshot(cleanerId);

      expect(result.rows).toEqual(mockRows);
    });
  });
});
