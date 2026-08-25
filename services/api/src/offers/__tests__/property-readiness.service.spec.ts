import { PropertyReadinessService } from '../contracts/property-readiness.service';
import { PropertyReadinessFailure } from '../contracts/property-readiness.interface';

/**
 * PropertyReadinessService unit tests.
 *
 * Validates all 7 readiness failure checks in priority order:
 * NOT_FOUND → NOT_OWNED → DELETED → NO_PHOTOS → INVALID_LOCATION → MISSING_REQUIRED_FIELDS → HAS_ACTIVE_OFFER
 */
describe('PropertyReadinessService', () => {
  let service: PropertyReadinessService;
  let mockDataSource: { query: jest.Mock };

  const PROPERTY_ID = '11111111-1111-1111-1111-111111111111';
  const HOST_ID = '22222222-2222-2222-2222-222222222222';
  const OTHER_USER_ID = '33333333-3333-3333-3333-333333333333';

  /** Fully valid property row */
  const validPropertyRow = {
    id: PROPERTY_ID,
    user_id: HOST_ID,
    name: 'My Apartment',
    type: 'apartment',
    address_street: '123 Main St',
    address_city: 'Bogotá',
    address_country: 'CO',
    location: 'POINT(-74.0721 4.7110)',
    square_meters: 80,
    bathrooms: 2,
    deleted_at: null,
  };

  beforeEach(() => {
    mockDataSource = { query: jest.fn() };
    service = new PropertyReadinessService(mockDataSource as any);
  });

  describe('NOT_FOUND', () => {
    it('should return NOT_FOUND when property does not exist', async () => {
      mockDataSource.query.mockResolvedValueOnce([]);

      const result = await service.check(PROPERTY_ID, HOST_ID);

      expect(result.ready).toBe(false);
      expect(result.reasons).toEqual<PropertyReadinessFailure[]>(['NOT_FOUND']);
    });

    it('should stop validation after NOT_FOUND (no further queries)', async () => {
      mockDataSource.query.mockResolvedValueOnce([]);

      await service.check(PROPERTY_ID, HOST_ID);

      // Only one query: findProperty
      expect(mockDataSource.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('NOT_OWNED', () => {
    it('should return NOT_OWNED when property belongs to a different user', async () => {
      mockDataSource.query.mockResolvedValueOnce([
        { ...validPropertyRow, user_id: OTHER_USER_ID },
      ]);

      const result = await service.check(PROPERTY_ID, HOST_ID);

      expect(result.ready).toBe(false);
      expect(result.reasons).toEqual<PropertyReadinessFailure[]>(['NOT_OWNED']);
    });

    it('should stop validation after NOT_OWNED (no further queries)', async () => {
      mockDataSource.query.mockResolvedValueOnce([
        { ...validPropertyRow, user_id: OTHER_USER_ID },
      ]);

      await service.check(PROPERTY_ID, HOST_ID);

      // Only one query: findProperty
      expect(mockDataSource.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('DELETED', () => {
    it('should include DELETED when property has a deleted_at timestamp', async () => {
      mockDataSource.query.mockResolvedValueOnce([
        { ...validPropertyRow, deleted_at: new Date('2024-01-01') },
      ]);
      // countPhotos
      mockDataSource.query.mockResolvedValueOnce([{ count: '3' }]);
      // checkActiveOffer
      mockDataSource.query.mockResolvedValueOnce([{ exists: false }]);

      const result = await service.check(PROPERTY_ID, HOST_ID);

      expect(result.ready).toBe(false);
      expect(result.reasons).toContain('DELETED');
    });
  });

  describe('NO_PHOTOS', () => {
    it('should include NO_PHOTOS when property has zero photos', async () => {
      mockDataSource.query.mockResolvedValueOnce([validPropertyRow]);
      mockDataSource.query.mockResolvedValueOnce([{ count: '0' }]);
      mockDataSource.query.mockResolvedValueOnce([{ exists: false }]);

      const result = await service.check(PROPERTY_ID, HOST_ID);

      expect(result.ready).toBe(false);
      expect(result.reasons).toContain('NO_PHOTOS');
    });

    it('should not include NO_PHOTOS when property has photos', async () => {
      mockDataSource.query.mockResolvedValueOnce([validPropertyRow]);
      mockDataSource.query.mockResolvedValueOnce([{ count: '5' }]);
      mockDataSource.query.mockResolvedValueOnce([{ exists: false }]);

      const result = await service.check(PROPERTY_ID, HOST_ID);

      expect(result.reasons).not.toContain('NO_PHOTOS');
    });
  });

  describe('INVALID_LOCATION', () => {
    it('should include INVALID_LOCATION when location is null', async () => {
      mockDataSource.query.mockResolvedValueOnce([
        { ...validPropertyRow, location: null },
      ]);
      mockDataSource.query.mockResolvedValueOnce([{ count: '2' }]);
      mockDataSource.query.mockResolvedValueOnce([{ exists: false }]);

      const result = await service.check(PROPERTY_ID, HOST_ID);

      expect(result.ready).toBe(false);
      expect(result.reasons).toContain('INVALID_LOCATION');
    });

    it('should include INVALID_LOCATION when location is empty string', async () => {
      mockDataSource.query.mockResolvedValueOnce([
        { ...validPropertyRow, location: '' },
      ]);
      mockDataSource.query.mockResolvedValueOnce([{ count: '2' }]);
      mockDataSource.query.mockResolvedValueOnce([{ exists: false }]);

      const result = await service.check(PROPERTY_ID, HOST_ID);

      expect(result.ready).toBe(false);
      expect(result.reasons).toContain('INVALID_LOCATION');
    });
  });

  describe('MISSING_REQUIRED_FIELDS', () => {
    it.each([
      ['name', { name: null }],
      ['name (empty)', { name: '' }],
      ['name (whitespace)', { name: '   ' }],
      ['type', { type: null }],
      ['address_street', { address_street: null }],
      ['address_city', { address_city: null }],
      ['address_country', { address_country: null }],
      ['square_meters (null)', { square_meters: null }],
      ['square_meters (zero)', { square_meters: 0 }],
      ['square_meters (negative)', { square_meters: -5 }],
      ['bathrooms (null)', { bathrooms: null }],
      ['bathrooms (zero)', { bathrooms: 0 }],
    ])('should include MISSING_REQUIRED_FIELDS when %s is invalid', async (_label, override) => {
      mockDataSource.query.mockResolvedValueOnce([
        { ...validPropertyRow, ...override },
      ]);
      mockDataSource.query.mockResolvedValueOnce([{ count: '2' }]);
      mockDataSource.query.mockResolvedValueOnce([{ exists: false }]);

      const result = await service.check(PROPERTY_ID, HOST_ID);

      expect(result.ready).toBe(false);
      expect(result.reasons).toContain('MISSING_REQUIRED_FIELDS');
    });
  });

  describe('HAS_ACTIVE_OFFER', () => {
    it('should include HAS_ACTIVE_OFFER when an active offer exists', async () => {
      mockDataSource.query.mockResolvedValueOnce([validPropertyRow]);
      mockDataSource.query.mockResolvedValueOnce([{ count: '2' }]);
      mockDataSource.query.mockResolvedValueOnce([{ exists: true }]);

      const result = await service.check(PROPERTY_ID, HOST_ID);

      expect(result.ready).toBe(false);
      expect(result.reasons).toContain('HAS_ACTIVE_OFFER');
    });

    it('should not include HAS_ACTIVE_OFFER when no active offer exists', async () => {
      mockDataSource.query.mockResolvedValueOnce([validPropertyRow]);
      mockDataSource.query.mockResolvedValueOnce([{ count: '2' }]);
      mockDataSource.query.mockResolvedValueOnce([{ exists: false }]);

      const result = await service.check(PROPERTY_ID, HOST_ID);

      expect(result.reasons).not.toContain('HAS_ACTIVE_OFFER');
    });

    it('should query with correct active states', async () => {
      mockDataSource.query.mockResolvedValueOnce([validPropertyRow]);
      mockDataSource.query.mockResolvedValueOnce([{ count: '2' }]);
      mockDataSource.query.mockResolvedValueOnce([{ exists: false }]);

      await service.check(PROPERTY_ID, HOST_ID);

      // Third query is the active offer check
      const activeOfferCall = mockDataSource.query.mock.calls[2];
      expect(activeOfferCall[1]).toEqual([
        PROPERTY_ID,
        ['DRAFT', 'PUBLISHED', 'ACTIVE'],
      ]);
    });
  });

  describe('ready property', () => {
    it('should return ready=true when all checks pass', async () => {
      mockDataSource.query.mockResolvedValueOnce([validPropertyRow]);
      mockDataSource.query.mockResolvedValueOnce([{ count: '3' }]);
      mockDataSource.query.mockResolvedValueOnce([{ exists: false }]);

      const result = await service.check(PROPERTY_ID, HOST_ID);

      expect(result.ready).toBe(true);
      expect(result.reasons).toEqual([]);
    });
  });

  describe('multiple failures', () => {
    it('should accumulate multiple reasons when property has multiple issues', async () => {
      mockDataSource.query.mockResolvedValueOnce([
        {
          ...validPropertyRow,
          deleted_at: new Date(),
          location: null,
          name: '',
        },
      ]);
      mockDataSource.query.mockResolvedValueOnce([{ count: '0' }]);
      mockDataSource.query.mockResolvedValueOnce([{ exists: true }]);

      const result = await service.check(PROPERTY_ID, HOST_ID);

      expect(result.ready).toBe(false);
      expect(result.reasons).toContain('DELETED');
      expect(result.reasons).toContain('NO_PHOTOS');
      expect(result.reasons).toContain('INVALID_LOCATION');
      expect(result.reasons).toContain('MISSING_REQUIRED_FIELDS');
      expect(result.reasons).toContain('HAS_ACTIVE_OFFER');
    });

    it('should maintain correct order of failure reasons', async () => {
      mockDataSource.query.mockResolvedValueOnce([
        {
          ...validPropertyRow,
          deleted_at: new Date(),
          location: null,
          name: null,
        },
      ]);
      mockDataSource.query.mockResolvedValueOnce([{ count: '0' }]);
      mockDataSource.query.mockResolvedValueOnce([{ exists: true }]);

      const result = await service.check(PROPERTY_ID, HOST_ID);

      const expectedOrder: PropertyReadinessFailure[] = [
        'DELETED',
        'NO_PHOTOS',
        'INVALID_LOCATION',
        'MISSING_REQUIRED_FIELDS',
        'HAS_ACTIVE_OFFER',
      ];

      // Verify order: each failure appears after the previous one
      for (let i = 1; i < expectedOrder.length; i++) {
        const prev = expectedOrder[i - 1]!;
        const curr = expectedOrder[i]!;
        const prevIdx = result.reasons.indexOf(prev);
        const currIdx = result.reasons.indexOf(curr);
        if (prevIdx !== -1 && currIdx !== -1) {
          expect(prevIdx).toBeLessThan(currIdx);
        }
      }
    });
  });
});
