import { Test, TestingModule } from '@nestjs/testing';
import {
  DefaultOfferEditabilityCheck,
  OFFER_EDITABILITY_CHECK,
  OfferEditabilityCheck,
} from '../contracts/offer-editability.interface';

describe('DefaultOfferEditabilityCheck', () => {
  let check: OfferEditabilityCheck;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: OFFER_EDITABILITY_CHECK,
          useClass: DefaultOfferEditabilityCheck,
        },
      ],
    }).compile();

    check = module.get<OfferEditabilityCheck>(OFFER_EDITABILITY_CHECK);
  });

  it('should be defined', () => {
    expect(check).toBeDefined();
  });

  describe('canModifyProperty', () => {
    it('should return editable=true with empty blockedFields for a single property', async () => {
      const result = await check.canModifyProperty('property-uuid-1', ['name']);

      expect(result.editable).toBe(true);
      expect(result.blockedFields).toEqual([]);
      expect(result.reason).toBeUndefined();
    });

    it('should return editable=true for multiple fields', async () => {
      const fields = ['name', 'description', 'address_street', 'square_meters'];
      const result = await check.canModifyProperty('property-uuid-2', fields);

      expect(result.editable).toBe(true);
      expect(result.blockedFields).toEqual([]);
    });

    it('should return editable=true with an empty fields array', async () => {
      const result = await check.canModifyProperty('property-uuid-3', []);

      expect(result.editable).toBe(true);
      expect(result.blockedFields).toEqual([]);
    });

    it('should return editable=true regardless of property ID', async () => {
      const propertyIds = [
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        '11111111-2222-3333-4444-555555555555',
        'property-with-active-offer',
      ];

      for (const propertyId of propertyIds) {
        const result = await check.canModifyProperty(propertyId, ['type']);
        expect(result.editable).toBe(true);
        expect(result.blockedFields).toEqual([]);
      }
    });

    it('should return a result matching the OfferEditabilityResult interface', async () => {
      const result = await check.canModifyProperty('any-id', ['name']);

      expect(result).toHaveProperty('editable');
      expect(result).toHaveProperty('blockedFields');
      expect(typeof result.editable).toBe('boolean');
      expect(Array.isArray(result.blockedFields)).toBe(true);
    });

    it('should not include a reason field in the default response', async () => {
      const result = await check.canModifyProperty('any-id', ['name']);

      expect(result.reason).toBeUndefined();
    });

    it('should return a promise', () => {
      const result = check.canModifyProperty('any-id', ['name']);

      expect(result).toBeInstanceOf(Promise);
    });
  });
});
