import { Test, TestingModule } from '@nestjs/testing';
import {
  PROPERTY_READINESS_CHECK,
  PropertyReadinessCheck,
} from '../contracts/offer-editability.interface';
import {
  DefaultPropertyReadinessCheck,
  READINESS_REASONS,
} from '../contracts/property-readiness.service';
import { PropertiesRepository } from '../properties.repository';
import { Property } from '../entities/property.entity';

describe('DefaultPropertyReadinessCheck', () => {
  let check: PropertyReadinessCheck;
  let mockRepository: jest.Mocked<Pick<PropertiesRepository, 'findOneIncludingDeleted' | 'countPhotos'>>;

  const buildProperty = (overrides: Partial<Property> = {}): Property => {
    const property = new Property();
    property.id = 'property-uuid-1';
    property.userId = 'user-uuid-1';
    property.name = 'My Apartment';
    property.type = 'apartment';
    property.description = 'A nice place';
    property.addressStreet = 'Cra 7 #45-12';
    property.addressCity = 'Bogotá';
    property.addressState = 'Cundinamarca';
    property.addressPostalCode = '110111';
    property.addressCountry = 'CO';
    property.location = '0101000020E6100000...';
    property.formattedAddress = 'Cra 7 #45-12, Bogotá, CO';
    property.locationSource = 'GEOCODED';
    property.squareMeters = 85;
    property.bedrooms = 2;
    property.bathrooms = 2;
    property.floorNumber = 5;
    property.hasParking = true;
    property.hasElevator = true;
    property.specialRequirements = [];
    property.checklistItems = [];
    property.accessInstructions = null;
    property.deletedAt = null;
    property.createdAt = new Date();
    property.updatedAt = new Date();
    return Object.assign(property, overrides);
  };

  beforeEach(async () => {
    mockRepository = {
      findOneIncludingDeleted: jest.fn(),
      countPhotos: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: PROPERTY_READINESS_CHECK,
          useClass: DefaultPropertyReadinessCheck,
        },
        {
          provide: PropertiesRepository,
          useValue: mockRepository,
        },
      ],
    }).compile();

    check = module.get<PropertyReadinessCheck>(PROPERTY_READINESS_CHECK);
  });

  it('should be defined', () => {
    expect(check).toBeDefined();
  });

  describe('isOfferReady', () => {
    describe('when property is fully ready', () => {
      it('should return ready=true with empty reasons', async () => {
        const property = buildProperty();
        mockRepository.findOneIncludingDeleted.mockResolvedValue(property);
        mockRepository.countPhotos.mockResolvedValue(3);

        const result = await check.isOfferReady('property-uuid-1');

        expect(result.ready).toBe(true);
        expect(result.reasons).toEqual([]);
      });

      it('should return ready=true with exactly 1 photo', async () => {
        const property = buildProperty();
        mockRepository.findOneIncludingDeleted.mockResolvedValue(property);
        mockRepository.countPhotos.mockResolvedValue(1);

        const result = await check.isOfferReady('property-uuid-1');

        expect(result.ready).toBe(true);
        expect(result.reasons).toEqual([]);
      });
    });

    describe('when property is not found', () => {
      it('should return ready=false with property_not_found reason', async () => {
        mockRepository.findOneIncludingDeleted.mockResolvedValue(null);

        const result = await check.isOfferReady('non-existent-id');

        expect(result.ready).toBe(false);
        expect(result.reasons).toContain(READINESS_REASONS.PROPERTY_NOT_FOUND);
        expect(result.reasons).toHaveLength(1);
      });
    });

    describe('when property is deleted', () => {
      it('should return ready=false with property_deleted reason', async () => {
        const property = buildProperty({ deletedAt: new Date() });
        mockRepository.findOneIncludingDeleted.mockResolvedValue(property);
        mockRepository.countPhotos.mockResolvedValue(3);

        const result = await check.isOfferReady('property-uuid-1');

        expect(result.ready).toBe(false);
        expect(result.reasons).toContain(READINESS_REASONS.PROPERTY_DELETED);
      });
    });

    describe('when photos are missing', () => {
      it('should return ready=false with missing_photos reason when count is 0', async () => {
        const property = buildProperty();
        mockRepository.findOneIncludingDeleted.mockResolvedValue(property);
        mockRepository.countPhotos.mockResolvedValue(0);

        const result = await check.isOfferReady('property-uuid-1');

        expect(result.ready).toBe(false);
        expect(result.reasons).toContain(READINESS_REASONS.MISSING_PHOTOS);
      });
    });

    describe('when required fields are missing', () => {
      it('should report missing_name when name is empty', async () => {
        const property = buildProperty({ name: '' });
        mockRepository.findOneIncludingDeleted.mockResolvedValue(property);
        mockRepository.countPhotos.mockResolvedValue(2);

        const result = await check.isOfferReady('property-uuid-1');

        expect(result.ready).toBe(false);
        expect(result.reasons).toContain(READINESS_REASONS.MISSING_NAME);
      });

      it('should report missing_type when type is empty', async () => {
        const property = buildProperty({ type: '' });
        mockRepository.findOneIncludingDeleted.mockResolvedValue(property);
        mockRepository.countPhotos.mockResolvedValue(2);

        const result = await check.isOfferReady('property-uuid-1');

        expect(result.ready).toBe(false);
        expect(result.reasons).toContain(READINESS_REASONS.MISSING_TYPE);
      });

      it('should report missing_address_street when addressStreet is empty', async () => {
        const property = buildProperty({ addressStreet: '' });
        mockRepository.findOneIncludingDeleted.mockResolvedValue(property);
        mockRepository.countPhotos.mockResolvedValue(2);

        const result = await check.isOfferReady('property-uuid-1');

        expect(result.ready).toBe(false);
        expect(result.reasons).toContain(READINESS_REASONS.MISSING_ADDRESS_STREET);
      });

      it('should report missing_address_city when addressCity is empty', async () => {
        const property = buildProperty({ addressCity: '' });
        mockRepository.findOneIncludingDeleted.mockResolvedValue(property);
        mockRepository.countPhotos.mockResolvedValue(2);

        const result = await check.isOfferReady('property-uuid-1');

        expect(result.ready).toBe(false);
        expect(result.reasons).toContain(READINESS_REASONS.MISSING_ADDRESS_CITY);
      });

      it('should report missing_address_country when addressCountry is empty', async () => {
        const property = buildProperty({ addressCountry: '' });
        mockRepository.findOneIncludingDeleted.mockResolvedValue(property);
        mockRepository.countPhotos.mockResolvedValue(2);

        const result = await check.isOfferReady('property-uuid-1');

        expect(result.ready).toBe(false);
        expect(result.reasons).toContain(READINESS_REASONS.MISSING_ADDRESS_COUNTRY);
      });

      it('should report missing_location when location is empty', async () => {
        const property = buildProperty({ location: '' });
        mockRepository.findOneIncludingDeleted.mockResolvedValue(property);
        mockRepository.countPhotos.mockResolvedValue(2);

        const result = await check.isOfferReady('property-uuid-1');

        expect(result.ready).toBe(false);
        expect(result.reasons).toContain(READINESS_REASONS.MISSING_LOCATION);
      });

      it('should report invalid_square_meters when squareMeters is 0', async () => {
        const property = buildProperty({ squareMeters: 0 });
        mockRepository.findOneIncludingDeleted.mockResolvedValue(property);
        mockRepository.countPhotos.mockResolvedValue(2);

        const result = await check.isOfferReady('property-uuid-1');

        expect(result.ready).toBe(false);
        expect(result.reasons).toContain(READINESS_REASONS.INVALID_SQUARE_METERS);
      });

      it('should report invalid_square_meters when squareMeters is negative', async () => {
        const property = buildProperty({ squareMeters: -10 });
        mockRepository.findOneIncludingDeleted.mockResolvedValue(property);
        mockRepository.countPhotos.mockResolvedValue(2);

        const result = await check.isOfferReady('property-uuid-1');

        expect(result.ready).toBe(false);
        expect(result.reasons).toContain(READINESS_REASONS.INVALID_SQUARE_METERS);
      });

      it('should report insufficient_bathrooms when bathrooms is 0', async () => {
        const property = buildProperty({ bathrooms: 0 });
        mockRepository.findOneIncludingDeleted.mockResolvedValue(property);
        mockRepository.countPhotos.mockResolvedValue(2);

        const result = await check.isOfferReady('property-uuid-1');

        expect(result.ready).toBe(false);
        expect(result.reasons).toContain(READINESS_REASONS.INSUFFICIENT_BATHROOMS);
      });
    });

    describe('when multiple issues exist', () => {
      it('should report all reasons at once', async () => {
        const property = buildProperty({
          name: '',
          addressStreet: '',
          squareMeters: 0,
          deletedAt: new Date(),
        });
        mockRepository.findOneIncludingDeleted.mockResolvedValue(property);
        mockRepository.countPhotos.mockResolvedValue(0);

        const result = await check.isOfferReady('property-uuid-1');

        expect(result.ready).toBe(false);
        expect(result.reasons).toContain(READINESS_REASONS.PROPERTY_DELETED);
        expect(result.reasons).toContain(READINESS_REASONS.MISSING_NAME);
        expect(result.reasons).toContain(READINESS_REASONS.MISSING_ADDRESS_STREET);
        expect(result.reasons).toContain(READINESS_REASONS.INVALID_SQUARE_METERS);
        expect(result.reasons).toContain(READINESS_REASONS.MISSING_PHOTOS);
        expect(result.reasons.length).toBeGreaterThanOrEqual(5);
      });
    });

    describe('interface conformance', () => {
      it('should return a result matching the PropertyReadinessResult interface', async () => {
        const property = buildProperty();
        mockRepository.findOneIncludingDeleted.mockResolvedValue(property);
        mockRepository.countPhotos.mockResolvedValue(2);

        const result = await check.isOfferReady('property-uuid-1');

        expect(result).toHaveProperty('ready');
        expect(result).toHaveProperty('reasons');
        expect(typeof result.ready).toBe('boolean');
        expect(Array.isArray(result.reasons)).toBe(true);
      });

      it('should return a promise', () => {
        mockRepository.findOneIncludingDeleted.mockResolvedValue(null);

        const result = check.isOfferReady('any-id');

        expect(result).toBeInstanceOf(Promise);
      });
    });
  });
});
