/**
 * Integration tests for Available Offers (Radar) endpoints.
 *
 * Tests the full controller → service → repository stack by mocking
 * the DataSource at the database boundary (PostGIS requires a real DB).
 * The auth guard and role resolution are also mocked at their boundaries
 * to focus on the business logic integration.
 *
 * Tasks covered:
 *   18.1 — Full radar flow (visibility contract, response shape)
 *   18.2 — Filter combinations (serviceType + price + distance)
 *   18.3 — Sort verification (all 4 sort options)
 *   18.4 — Pagination uniqueness (no duplicates across pages)
 *   18.5 — Distance calculation (known coordinates, tolerance check)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AvailableOffersController } from '../available-offers.controller';
import { AvailableOffersService } from '../available-offers.service';
import { AvailableOffersRepository } from '../available-offers.repository';
import { User } from '../../../auth/entities/user.entity';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { AvailableOfferRow } from '../dto/available-offers.types';
import { UserRole } from '../../../roles/roles.types';

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

const CLEANER_ID = '11111111-1111-1111-1111-111111111111';
const KEYCLOAK_ID = 'kc-cleaner-integration-test';

function buildOfferRow(overrides: Partial<AvailableOfferRow> = {}): AvailableOfferRow {
  return {
    offer_id: crypto.randomUUID(),
    property_name_snapshot: 'Sunny Apartment',
    property_type_snapshot: 'apartment',
    property_city_snapshot: 'Miami',
    property_cover_photo_snapshot: 'https://storage.bidclean.tech/photos/cover.jpg',
    service_type: 'standard',
    description: 'Weekly cleaning needed',
    scheduled_at: new Date(Date.now() + 4 * 60 * 60 * 1000), // 4h from now
    timezone: 'America/New_York',
    estimated_duration_minutes: 90,
    offered_price_cents: 5000,
    cleaner_commission_cents: 150,
    cleaner_payout_cents: 4850,
    currency: 'USD',
    published_at: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
    distance_meters: 3200,
    is_urgent: false,
    public_lat: 25.7617,
    public_lng: -80.1918,
    ...overrides,
  };
}

function buildUrgentOfferRow(overrides: Partial<AvailableOfferRow> = {}): AvailableOfferRow {
  return buildOfferRow({
    scheduled_at: new Date(Date.now() + 60 * 60 * 1000), // 1h from now (urgent)
    is_urgent: true,
    ...overrides,
  });
}

function buildCleanerUser(): Partial<User> {
  return {
    id: CLEANER_ID,
    keycloakId: KEYCLOAK_ID,
    email: 'cleaner@test.com',
    fullName: 'Test Cleaner',
    roles: [UserRole.CLEANER],
    activeRole: UserRole.CLEANER,
    country: 'US',
    language: 'en',
    isEmailVerified: true,
    onboardingStatusCleaner: 'COMPLETED',
    onboardingStatusHost: 'NOT_STARTED',
    deletionStatus: null,
  };
}

// ---------------------------------------------------------------------------
// Module setup
// ---------------------------------------------------------------------------

describe('Available Offers Integration Tests', () => {
  let app: INestApplication;
  let mockDataSource: { query: jest.Mock };
  let mockUserRepository: { findOne: jest.Mock };

  beforeAll(async () => {
    mockDataSource = { query: jest.fn() };
    mockUserRepository = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AvailableOffersController],
      providers: [
        AvailableOffersService,
        AvailableOffersRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = {
            keycloakId: KEYCLOAK_ID,
            email: 'cleaner@test.com',
            emailVerified: true,
          };
          return true;
        },
      })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockUserRepository.findOne.mockResolvedValue(buildCleanerUser());
  });

  // =========================================================================
  // 18.1 — Full Radar Flow (Visibility Contract + Response Shape)
  // =========================================================================

  describe('18.1 — Full Radar Flow', () => {
    it('should return 200 with correct response shape for authenticated Cleaner', async () => {
      const rows = [buildOfferRow(), buildOfferRow()];
      // Data query returns rows
      mockDataSource.query.mockResolvedValueOnce(rows);
      // Count query returns total
      mockDataSource.query.mockResolvedValueOnce([{ total: 2 }]);

      const res = await request(app.getHttpServer())
        .get('/offers/available')
        .expect(200);

      expect(res.body).toHaveProperty('items');
      expect(res.body).toHaveProperty('pagination');
      expect(res.body.items).toHaveLength(2);
      expect(res.body.pagination).toMatchObject({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
      });
    });

    it('should return correct offer DTO shape with all required fields', async () => {
      const row = buildOfferRow();
      mockDataSource.query.mockResolvedValueOnce([row]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 1 }]);

      const res = await request(app.getHttpServer())
        .get('/offers/available')
        .expect(200);

      const offer = res.body.items[0];
      expect(offer).toHaveProperty('offerId', row.offer_id);
      expect(offer).toHaveProperty('propertySnapshot');
      expect(offer.propertySnapshot).toMatchObject({
        name: row.property_name_snapshot,
        type: row.property_type_snapshot,
        city: row.property_city_snapshot,
        coverPhotoUrl: row.property_cover_photo_snapshot,
      });
      expect(offer).toHaveProperty('serviceType', row.service_type);
      expect(offer).toHaveProperty('description', row.description);
      expect(offer).toHaveProperty('scheduledAt');
      expect(offer).toHaveProperty('timezone', row.timezone);
      expect(offer).toHaveProperty('estimatedDurationMinutes', row.estimated_duration_minutes);
      expect(offer).toHaveProperty('priceBreakdown');
      expect(offer.priceBreakdown).toMatchObject({
        offeredPriceCents: row.offered_price_cents,
        commissionCents: row.cleaner_commission_cents,
        payoutCents: row.cleaner_payout_cents,
        currency: row.currency,
      });
      expect(offer).toHaveProperty('distanceMeters', row.distance_meters);
      expect(offer).toHaveProperty('publishedAt');
      expect(offer).toHaveProperty('isUrgent');
      expect(offer).toHaveProperty('publicLocation');
      expect(offer.publicLocation).toMatchObject({
        lat: row.public_lat,
        lng: row.public_lng,
      });
    });

    it('should only return offers with ACTIVE state and SENT delivery status (visibility contract)', async () => {
      // The repository builds a WHERE clause enforcing:
      // od.cleaner_id = $1 AND od.delivery_status = 'SENT' AND o.state = 'ACTIVE' AND o.scheduled_at > NOW()
      // We verify the query was called with the correct cleanerId param
      const activeOffer = buildOfferRow();
      mockDataSource.query.mockResolvedValueOnce([activeOffer]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 1 }]);

      await request(app.getHttpServer())
        .get('/offers/available')
        .expect(200);

      // Verify the data query was called
      expect(mockDataSource.query).toHaveBeenCalledTimes(2);

      // First call is the data query — verify it includes the cleaner ID as first param
      const dataQueryCall = mockDataSource.query.mock.calls[0];
      const queryStr = dataQueryCall[0] as string;
      const queryParams = dataQueryCall[1] as unknown[];

      // SQL must enforce visibility contract
      expect(queryStr).toContain("od.delivery_status = 'SENT'");
      expect(queryStr).toContain("o.state = 'ACTIVE'");
      expect(queryStr).toContain('o.scheduled_at > NOW()');
      expect(queryStr).toContain('od.cleaner_id = $1');
      expect(queryParams[0]).toBe(CLEANER_ID);
    });

    it('should not include expired offers (scheduled_at in the past)', async () => {
      // Expired offers are excluded by `o.scheduled_at > NOW()` in the WHERE clause
      mockDataSource.query.mockResolvedValueOnce([]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 0 }]);

      const res = await request(app.getHttpServer())
        .get('/offers/available')
        .expect(200);

      expect(res.body.items).toHaveLength(0);

      // Verify the query enforces not-expired
      const queryStr = mockDataSource.query.mock.calls[0][0] as string;
      expect(queryStr).toContain('o.scheduled_at > NOW()');
    });

    it('should return 403 when user does not have Cleaner role', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        ...buildCleanerUser(),
        roles: [UserRole.HOST],
        activeRole: UserRole.HOST,
      });

      await request(app.getHttpServer())
        .get('/offers/available')
        .expect(403);
    });

    it('should return 403 when user is not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await request(app.getHttpServer())
        .get('/offers/available')
        .expect(403);
    });

    it('should NOT expose private fields (street, postal_code, exact location) in response', async () => {
      const row = buildOfferRow();
      mockDataSource.query.mockResolvedValueOnce([row]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 1 }]);

      const res = await request(app.getHttpServer())
        .get('/offers/available')
        .expect(200);

      const offer = res.body.items[0];
      const serialized = JSON.stringify(offer);

      // Privacy: these fields must NEVER appear in the response
      expect(serialized).not.toContain('address_street');
      expect(serialized).not.toContain('address_state');
      expect(serialized).not.toContain('address_postal_code');
      expect(serialized).not.toContain('formatted_address');
      expect(serialized).not.toContain('access_instructions');
      expect(serialized).not.toContain('location_source');
      expect(offer).not.toHaveProperty('exactLocation');
      expect(offer).not.toHaveProperty('location');
    });
  });

  // =========================================================================
  // 18.2 — Filter Combinations
  // =========================================================================

  describe('18.2 — Filter Combinations', () => {
    it('should apply serviceType filter correctly (comma-separated)', async () => {
      const standardOffer = buildOfferRow({ service_type: 'standard' });
      const deepOffer = buildOfferRow({ service_type: 'deep' });
      mockDataSource.query.mockResolvedValueOnce([standardOffer, deepOffer]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 2 }]);

      const res = await request(app.getHttpServer())
        .get('/offers/available?serviceType=standard,deep')
        .expect(200);

      expect(res.body.items).toHaveLength(2);

      // Verify the query includes service type filter
      const queryStr = mockDataSource.query.mock.calls[0][0] as string;
      expect(queryStr).toContain('o.service_type = ANY($');

      const queryParams = mockDataSource.query.mock.calls[0][1] as unknown[];
      expect(queryParams).toContainEqual(['standard', 'deep']);
    });

    it('should apply minPriceCents and maxPriceCents filters', async () => {
      const offer = buildOfferRow({ cleaner_payout_cents: 3000 });
      mockDataSource.query.mockResolvedValueOnce([offer]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 1 }]);

      const res = await request(app.getHttpServer())
        .get('/offers/available?minPriceCents=2000&maxPriceCents=5000')
        .expect(200);

      expect(res.body.items).toHaveLength(1);

      const queryStr = mockDataSource.query.mock.calls[0][0] as string;
      expect(queryStr).toContain('o.cleaner_payout_cents >= $');
      expect(queryStr).toContain('o.cleaner_payout_cents <= $');

      const queryParams = mockDataSource.query.mock.calls[0][1] as unknown[];
      expect(queryParams).toContain(2000);
      expect(queryParams).toContain(5000);
    });

    it('should apply maxDistanceMeters filter using ST_DWithin', async () => {
      const offer = buildOfferRow({ distance_meters: 4500 });
      mockDataSource.query.mockResolvedValueOnce([offer]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 1 }]);

      const res = await request(app.getHttpServer())
        .get('/offers/available?maxDistanceMeters=5000')
        .expect(200);

      expect(res.body.items).toHaveLength(1);

      const queryStr = mockDataSource.query.mock.calls[0][0] as string;
      expect(queryStr).toContain('ST_DWithin');

      const queryParams = mockDataSource.query.mock.calls[0][1] as unknown[];
      expect(queryParams).toContain(5000);
    });

    it('should apply all filters simultaneously', async () => {
      const matchingOffer = buildOfferRow({
        service_type: 'deep',
        cleaner_payout_cents: 4000,
        distance_meters: 2000,
      });
      mockDataSource.query.mockResolvedValueOnce([matchingOffer]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 1 }]);

      const res = await request(app.getHttpServer())
        .get(
          '/offers/available?serviceType=deep&minPriceCents=3000&maxPriceCents=5000&maxDistanceMeters=3000',
        )
        .expect(200);

      expect(res.body.items).toHaveLength(1);

      const queryStr = mockDataSource.query.mock.calls[0][0] as string;
      expect(queryStr).toContain('o.service_type = ANY($');
      expect(queryStr).toContain('o.cleaner_payout_cents >= $');
      expect(queryStr).toContain('o.cleaner_payout_cents <= $');
      expect(queryStr).toContain('ST_DWithin');

      // Verify the offer matches all filters
      const offer = res.body.items[0];
      expect(offer.serviceType).toBe('deep');
      expect(offer.priceBreakdown.payoutCents).toBeGreaterThanOrEqual(3000);
      expect(offer.priceBreakdown.payoutCents).toBeLessThanOrEqual(5000);
    });

    it('should apply scheduledBefore and scheduledAfter filters', async () => {
      const scheduledAfter = '2025-01-15T00:00:00Z';
      const scheduledBefore = '2025-01-20T23:59:59Z';

      const offer = buildOfferRow({
        scheduled_at: new Date('2025-01-18T10:00:00Z'),
      });
      mockDataSource.query.mockResolvedValueOnce([offer]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 1 }]);

      await request(app.getHttpServer())
        .get(
          `/offers/available?scheduledAfter=${scheduledAfter}&scheduledBefore=${scheduledBefore}`,
        )
        .expect(200);

      const queryStr = mockDataSource.query.mock.calls[0][0] as string;
      expect(queryStr).toContain('o.scheduled_at <= $');
      expect(queryStr).toContain('o.scheduled_at >= $');

      const queryParams = mockDataSource.query.mock.calls[0][1] as unknown[];
      expect(queryParams).toContain(scheduledBefore);
      expect(queryParams).toContain(scheduledAfter);
    });

    it('should return empty array when no offers match filters', async () => {
      mockDataSource.query.mockResolvedValueOnce([]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 0 }]);

      const res = await request(app.getHttpServer())
        .get('/offers/available?serviceType=post_construction&minPriceCents=100000')
        .expect(200);

      expect(res.body.items).toHaveLength(0);
      expect(res.body.pagination.total).toBe(0);
    });

    it('should reject invalid filter values with 400', async () => {
      await request(app.getHttpServer())
        .get('/offers/available?minPriceCents=-100')
        .expect(400);
    });
  });

  // =========================================================================
  // 18.3 — Sort Verification
  // =========================================================================

  describe('18.3 — Sort Verification', () => {
    it('should sort by distance_asc (default) — nearest first', async () => {
      const near = buildOfferRow({ distance_meters: 1000, offer_id: 'near' });
      const mid = buildOfferRow({ distance_meters: 3000, offer_id: 'mid' });
      const far = buildOfferRow({ distance_meters: 8000, offer_id: 'far' });
      mockDataSource.query.mockResolvedValueOnce([near, mid, far]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 3 }]);

      const res = await request(app.getHttpServer())
        .get('/offers/available?sort=distance_asc')
        .expect(200);

      expect(res.body.items).toHaveLength(3);

      // Verify ordering invariant: distance[i] <= distance[i+1]
      for (let i = 0; i < res.body.items.length - 1; i++) {
        expect(res.body.items[i].distanceMeters).toBeLessThanOrEqual(
          res.body.items[i + 1].distanceMeters,
        );
      }

      // Verify SQL uses correct ORDER BY
      const queryStr = mockDataSource.query.mock.calls[0][0] as string;
      expect(queryStr).toContain('ORDER BY distance_meters ASC');
    });

    it('should sort by price_desc — highest payout first', async () => {
      const expensive = buildOfferRow({
        cleaner_payout_cents: 8000,
        offer_id: 'expensive',
      });
      const medium = buildOfferRow({
        cleaner_payout_cents: 5000,
        offer_id: 'medium',
      });
      const cheap = buildOfferRow({
        cleaner_payout_cents: 2000,
        offer_id: 'cheap',
      });
      mockDataSource.query.mockResolvedValueOnce([expensive, medium, cheap]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 3 }]);

      const res = await request(app.getHttpServer())
        .get('/offers/available?sort=price_desc')
        .expect(200);

      // Verify ordering invariant: payout[i] >= payout[i+1]
      for (let i = 0; i < res.body.items.length - 1; i++) {
        expect(res.body.items[i].priceBreakdown.payoutCents).toBeGreaterThanOrEqual(
          res.body.items[i + 1].priceBreakdown.payoutCents,
        );
      }

      const queryStr = mockDataSource.query.mock.calls[0][0] as string;
      expect(queryStr).toContain('ORDER BY o.cleaner_payout_cents DESC');
    });

    it('should sort by scheduled_asc — soonest first', async () => {
      const soon = buildOfferRow({
        scheduled_at: new Date(Date.now() + 2 * 60 * 60 * 1000),
        offer_id: 'soon',
      });
      const later = buildOfferRow({
        scheduled_at: new Date(Date.now() + 6 * 60 * 60 * 1000),
        offer_id: 'later',
      });
      const latest = buildOfferRow({
        scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        offer_id: 'latest',
      });
      mockDataSource.query.mockResolvedValueOnce([soon, later, latest]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 3 }]);

      const res = await request(app.getHttpServer())
        .get('/offers/available?sort=scheduled_asc')
        .expect(200);

      // Verify ordering invariant: scheduled[i] <= scheduled[i+1]
      for (let i = 0; i < res.body.items.length - 1; i++) {
        const timeA = new Date(res.body.items[i].scheduledAt).getTime();
        const timeB = new Date(res.body.items[i + 1].scheduledAt).getTime();
        expect(timeA).toBeLessThanOrEqual(timeB);
      }

      const queryStr = mockDataSource.query.mock.calls[0][0] as string;
      expect(queryStr).toContain('ORDER BY o.scheduled_at ASC');
    });

    it('should sort by published_desc — most recently published first', async () => {
      const newest = buildOfferRow({
        published_at: new Date(Date.now() - 10 * 60 * 1000),
        offer_id: 'newest',
      });
      const older = buildOfferRow({
        published_at: new Date(Date.now() - 60 * 60 * 1000),
        offer_id: 'older',
      });
      const oldest = buildOfferRow({
        published_at: new Date(Date.now() - 3 * 60 * 60 * 1000),
        offer_id: 'oldest',
      });
      mockDataSource.query.mockResolvedValueOnce([newest, older, oldest]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 3 }]);

      const res = await request(app.getHttpServer())
        .get('/offers/available?sort=published_desc')
        .expect(200);

      // Verify ordering invariant: published[i] >= published[i+1]
      for (let i = 0; i < res.body.items.length - 1; i++) {
        const timeA = new Date(res.body.items[i].publishedAt).getTime();
        const timeB = new Date(res.body.items[i + 1].publishedAt).getTime();
        expect(timeA).toBeGreaterThanOrEqual(timeB);
      }

      const queryStr = mockDataSource.query.mock.calls[0][0] as string;
      expect(queryStr).toContain('ORDER BY o.published_at DESC');
    });

    it('should default to distance_asc when no sort parameter is provided', async () => {
      const near = buildOfferRow({ distance_meters: 500 });
      const far = buildOfferRow({ distance_meters: 9000 });
      mockDataSource.query.mockResolvedValueOnce([near, far]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 2 }]);

      await request(app.getHttpServer())
        .get('/offers/available')
        .expect(200);

      const queryStr = mockDataSource.query.mock.calls[0][0] as string;
      expect(queryStr).toContain('ORDER BY distance_meters ASC');
    });

    it('should reject invalid sort option with 400', async () => {
      await request(app.getHttpServer())
        .get('/offers/available?sort=invalid_sort')
        .expect(400);
    });
  });

  // =========================================================================
  // 18.4 — Pagination Uniqueness
  // =========================================================================

  describe('18.4 — Pagination Uniqueness', () => {
    it('should return no duplicate offerIds across pages', async () => {
      // Page 1: 3 offers
      const page1Offers = [
        buildOfferRow({ offer_id: 'offer-1' }),
        buildOfferRow({ offer_id: 'offer-2' }),
        buildOfferRow({ offer_id: 'offer-3' }),
      ];
      // Page 2: 3 more offers
      const page2Offers = [
        buildOfferRow({ offer_id: 'offer-4' }),
        buildOfferRow({ offer_id: 'offer-5' }),
        buildOfferRow({ offer_id: 'offer-6' }),
      ];
      // Page 3: 1 remaining offer
      const page3Offers = [buildOfferRow({ offer_id: 'offer-7' })];

      // Page 1 request
      mockDataSource.query.mockResolvedValueOnce(page1Offers);
      mockDataSource.query.mockResolvedValueOnce([{ total: 7 }]);

      const res1 = await request(app.getHttpServer())
        .get('/offers/available?page=1&limit=3')
        .expect(200);

      expect(res1.body.pagination).toMatchObject({
        page: 1,
        limit: 3,
        total: 7,
        totalPages: 3,
      });

      // Page 2 request
      mockDataSource.query.mockResolvedValueOnce(page2Offers);
      mockDataSource.query.mockResolvedValueOnce([{ total: 7 }]);

      const res2 = await request(app.getHttpServer())
        .get('/offers/available?page=2&limit=3')
        .expect(200);

      // Page 3 request
      mockDataSource.query.mockResolvedValueOnce(page3Offers);
      mockDataSource.query.mockResolvedValueOnce([{ total: 7 }]);

      const res3 = await request(app.getHttpServer())
        .get('/offers/available?page=3&limit=3')
        .expect(200);

      // Collect all offer IDs across all pages
      const allOfferIds = [
        ...res1.body.items.map((o: any) => o.offerId),
        ...res2.body.items.map((o: any) => o.offerId),
        ...res3.body.items.map((o: any) => o.offerId),
      ];

      // Verify no duplicates
      const uniqueIds = new Set(allOfferIds);
      expect(uniqueIds.size).toBe(allOfferIds.length);
      expect(allOfferIds).toHaveLength(7);
    });

    it('should maintain consistent total count across pages', async () => {
      // Page 1
      mockDataSource.query.mockResolvedValueOnce([
        buildOfferRow({ offer_id: 'a' }),
        buildOfferRow({ offer_id: 'b' }),
      ]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 4 }]);

      // Page 2
      mockDataSource.query.mockResolvedValueOnce([
        buildOfferRow({ offer_id: 'c' }),
        buildOfferRow({ offer_id: 'd' }),
      ]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 4 }]);

      const res1 = await request(app.getHttpServer())
        .get('/offers/available?page=1&limit=2')
        .expect(200);

      const res2 = await request(app.getHttpServer())
        .get('/offers/available?page=2&limit=2')
        .expect(200);

      expect(res1.body.pagination.total).toBe(res2.body.pagination.total);
      expect(res1.body.pagination.totalPages).toBe(2);
      expect(res2.body.pagination.totalPages).toBe(2);
    });

    it('should calculate totalPages correctly', async () => {
      mockDataSource.query.mockResolvedValueOnce([buildOfferRow()]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 47 }]);

      const res = await request(app.getHttpServer())
        .get('/offers/available?page=1&limit=20')
        .expect(200);

      expect(res.body.pagination.totalPages).toBe(3); // ceil(47/20) = 3
    });

    it('should return empty items when page exceeds totalPages', async () => {
      mockDataSource.query.mockResolvedValueOnce([]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 5 }]);

      const res = await request(app.getHttpServer())
        .get('/offers/available?page=10&limit=5')
        .expect(200);

      expect(res.body.items).toHaveLength(0);
      expect(res.body.pagination.total).toBe(5);
    });

    it('should pass correct LIMIT and OFFSET to SQL query', async () => {
      mockDataSource.query.mockResolvedValueOnce([]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 0 }]);

      await request(app.getHttpServer())
        .get('/offers/available?page=3&limit=10')
        .expect(200);

      // Page 3, limit 10 → OFFSET = (3-1)*10 = 20
      const queryParams = mockDataSource.query.mock.calls[0][1] as unknown[];
      // Last two params are limit and offset
      const limit = queryParams[queryParams.length - 2];
      const offset = queryParams[queryParams.length - 1];
      expect(limit).toBe(10);
      expect(offset).toBe(20);
    });

    it('should enforce max limit of 50', async () => {
      await request(app.getHttpServer())
        .get('/offers/available?limit=100')
        .expect(400);
    });
  });

  // =========================================================================
  // 18.5 — Distance Calculation
  // =========================================================================

  describe('18.5 — Distance Calculation', () => {
    it('should include distance_meters in SQL query using ST_Distance', async () => {
      const offer = buildOfferRow({ distance_meters: 4235 });
      mockDataSource.query.mockResolvedValueOnce([offer]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 1 }]);

      const res = await request(app.getHttpServer())
        .get('/offers/available')
        .expect(200);

      // Verify the query uses ST_Distance with geography cast
      const queryStr = mockDataSource.query.mock.calls[0][0] as string;
      expect(queryStr).toContain('ST_Distance');
      expect(queryStr).toContain('o.public_location::geography');
      expect(queryStr).toContain('cp.work_zone_center::geography');
      expect(queryStr).toContain('::integer AS distance_meters');

      // Verify the distance value is returned in the response
      expect(res.body.items[0].distanceMeters).toBe(4235);
    });

    it('should return distance as an integer (meters)', async () => {
      const offer = buildOfferRow({ distance_meters: 1523 });
      mockDataSource.query.mockResolvedValueOnce([offer]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 1 }]);

      const res = await request(app.getHttpServer())
        .get('/offers/available')
        .expect(200);

      const distanceMeters = res.body.items[0].distanceMeters;
      expect(Number.isInteger(distanceMeters)).toBe(true);
      expect(distanceMeters).toBe(1523);
    });

    it('should compute distance from work zone center NOT from GPS position', async () => {
      mockDataSource.query.mockResolvedValueOnce([buildOfferRow()]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 1 }]);

      await request(app.getHttpServer())
        .get('/offers/available')
        .expect(200);

      const queryStr = mockDataSource.query.mock.calls[0][0] as string;

      // Must use cleaner_profiles.work_zone_center for distance
      expect(queryStr).toContain('cp.work_zone_center');
      // Must join cleaner_profiles
      expect(queryStr).toContain('cleaner_profiles');
      expect(queryStr).toContain('INNER JOIN cleaner_profiles cp');
    });

    it('should use maxDistanceMeters with ST_DWithin (not post-filtering)', async () => {
      mockDataSource.query.mockResolvedValueOnce([]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 0 }]);

      await request(app.getHttpServer())
        .get('/offers/available?maxDistanceMeters=5000')
        .expect(200);

      const queryStr = mockDataSource.query.mock.calls[0][0] as string;

      // ST_DWithin is used for distance filtering (server-side spatial predicate)
      expect(queryStr).toContain('ST_DWithin');
      expect(queryStr).toContain('o.public_location::geography');
      expect(queryStr).toContain('cp.work_zone_center::geography');

      // The distance parameter is passed as a query param
      const queryParams = mockDataSource.query.mock.calls[0][1] as unknown[];
      expect(queryParams).toContain(5000);
    });

    it('should return correct distance for known coordinates (tolerance check)', async () => {
      // Known coordinates:
      // Cleaner work zone center: 25.7617° N, -80.1918° W (Miami)
      // Offer public location: 25.7907° N, -80.1300° W (Miami Beach)
      // Expected distance: ~6500m (±200m due to spheroid model)
      //
      // Since we mock the DB, we verify the distance passes through unchanged.
      // In a real PostGIS environment, the actual calculation would be verified.
      const knownDistance = 6485; // meters (as PostGIS would compute)
      const offer = buildOfferRow({
        distance_meters: knownDistance,
        public_lat: 25.7907,
        public_lng: -80.13,
      });
      mockDataSource.query.mockResolvedValueOnce([offer]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 1 }]);

      const res = await request(app.getHttpServer())
        .get('/offers/available')
        .expect(200);

      const returnedDistance = res.body.items[0].distanceMeters;
      // The service returns the distance as computed by PostGIS (integer meters)
      expect(returnedDistance).toBe(knownDistance);
      // Tolerance check: the value should be reasonable for Miami → Miami Beach
      expect(returnedDistance).toBeGreaterThan(5000);
      expect(returnedDistance).toBeLessThan(8000);
    });

    it('should join offers with cleaner_profiles via offer_deliveries', async () => {
      mockDataSource.query.mockResolvedValueOnce([]);
      mockDataSource.query.mockResolvedValueOnce([{ total: 0 }]);

      await request(app.getHttpServer())
        .get('/offers/available')
        .expect(200);

      const queryStr = mockDataSource.query.mock.calls[0][0] as string;

      // Verify the correct 3-table join path
      expect(queryStr).toContain('FROM offers o');
      expect(queryStr).toContain('INNER JOIN offer_deliveries od ON od.offer_id = o.id');
      expect(queryStr).toContain('INNER JOIN cleaner_profiles cp ON cp.user_id = od.cleaner_id');
    });
  });

  // =========================================================================
  // Snapshot Endpoint Tests (supplementary for 18.1)
  // =========================================================================

  describe('Snapshot Endpoint — GET /offers/available/snapshot', () => {
    it('should return full unpaginated offer set with syncedAt', async () => {
      const rows = [
        buildOfferRow({ offer_id: 'snap-1' }),
        buildOfferRow({ offer_id: 'snap-2' }),
        buildOfferRow({ offer_id: 'snap-3' }),
      ];
      mockDataSource.query.mockResolvedValueOnce(rows);

      const res = await request(app.getHttpServer())
        .get('/offers/available/snapshot')
        .expect(200);

      expect(res.body).toHaveProperty('offers');
      expect(res.body).toHaveProperty('syncedAt');
      expect(res.body.offers).toHaveLength(3);
      expect(new Date(res.body.syncedAt).getTime()).toBeGreaterThan(0);
    });

    it('should enforce rate limiting (429 on rapid requests)', async () => {
      const rows = [buildOfferRow()];
      mockDataSource.query.mockResolvedValue(rows);

      // Clear in-memory rate limit state to isolate this test
      const service = app.get(AvailableOffersService);
      (service as unknown as { snapshotLastCallMap: Map<string, number> }).snapshotLastCallMap.clear();

      // First request should succeed
      await request(app.getHttpServer())
        .get('/offers/available/snapshot')
        .expect(200);

      // Second request within 30s should be rate limited
      await request(app.getHttpServer())
        .get('/offers/available/snapshot')
        .expect(429);
    });
  });
});
