import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { PropertiesService, CreatePropertyResult } from '../properties.service';
import { PropertiesRepository } from '../properties.repository';
import { PropertyPhotoService } from '../photo/property-photo.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import { OFFER_EDITABILITY_CHECK } from '../contracts/offer-editability.interface';
import { CreatePropertyDto } from '../dto/create-property.dto';
import { Property } from '../entities/property.entity';

describe('PropertiesService', () => {
  let service: PropertiesService;
  let repository: jest.Mocked<Partial<PropertiesRepository>>;
  let dataSource: jest.Mocked<Partial<DataSource>>;

  const mockUserId = 'user-uuid-1234';
  const mockPropertyId = 'property-uuid-5678';

  const validDto: CreatePropertyDto = {
    name: 'Test Apartment',
    type: 'apartment',
    description: 'A cozy apartment',
    addressStreet: '123 Main St',
    addressCity: 'Bogota',
    addressState: 'Cundinamarca',
    addressPostalCode: '110111',
    addressCountry: 'CO',
    lat: 4.711,
    lng: -74.0721,
    locationSource: 'GEOCODED',
    formattedAddress: '123 Main St, Bogota, Colombia',
    squareMeters: 80,
    bedrooms: 2,
    bathrooms: 1,
    floorNumber: 3,
    hasParking: true,
    hasElevator: true,
    specialRequirements: ['pets'],
    checklistItems: ['Clean kitchen'],
    accessInstructions: 'Ring bell twice',
  };

  const mockRawRow = {
    id: mockPropertyId,
    user_id: mockUserId,
    name: validDto.name,
    type: validDto.type,
    description: validDto.description,
    address_street: validDto.addressStreet,
    address_city: validDto.addressCity,
    address_state: validDto.addressState,
    address_postal_code: validDto.addressPostalCode,
    address_country: validDto.addressCountry,
    location: '0101000020E6100000',
    formatted_address: validDto.formattedAddress,
    location_source: validDto.locationSource,
    square_meters: validDto.squareMeters,
    bedrooms: validDto.bedrooms,
    bathrooms: validDto.bathrooms,
    floor_number: validDto.floorNumber,
    has_parking: validDto.hasParking,
    has_elevator: validDto.hasElevator,
    special_requirements: validDto.specialRequirements,
    checklist_items: validDto.checklistItems,
    access_instructions: validDto.accessInstructions,
    deleted_at: null,
    created_at: new Date('2024-01-01T00:00:00Z'),
    updated_at: new Date('2024-01-01T00:00:00Z'),
  };

  beforeEach(async () => {
    repository = {
      findByIdempotencyKey: jest.fn(),
    };

    dataSource = {
      query: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PropertiesService,
        { provide: PropertiesRepository, useValue: repository },
        { provide: PropertyPhotoService, useValue: {} },
        { provide: GeocodingService, useValue: {} },
        { provide: OFFER_EDITABILITY_CHECK, useValue: { canModifyProperty: jest.fn() } },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<PropertiesService>(PropertiesService);
  });

  describe('createProperty', () => {
    it('should create a new property and return isNew=true', async () => {
      (dataSource.query as jest.Mock).mockResolvedValueOnce([mockRawRow]);

      const result: CreatePropertyResult = await service.createProperty(
        mockUserId,
        validDto,
      );

      expect(result.isNew).toBe(true);
      expect(result.property.id).toBe(mockPropertyId);
      expect(result.property.name).toBe(validDto.name);
      expect(result.property.locationSource).toBe('GEOCODED');
      expect(result.property.userId).toBe(mockUserId);
    });

    it('should call INSERT with ST_MakePoint for PostGIS point storage', async () => {
      (dataSource.query as jest.Mock).mockResolvedValueOnce([mockRawRow]);

      await service.createProperty(mockUserId, validDto);

      const insertCall = (dataSource.query as jest.Mock).mock.calls[0];
      const sql = insertCall[0] as string;
      const params = insertCall[1] as unknown[];

      expect(sql).toContain('ST_MakePoint($10, $11)::geography');
      expect(params[9]).toBe(validDto.lng);
      expect(params[10]).toBe(validDto.lat);
    });

    it('should return existing property when idempotency key matches (isNew=false)', async () => {
      const existingProperty = new Property();
      existingProperty.id = mockPropertyId;
      existingProperty.name = validDto.name;
      existingProperty.userId = mockUserId;

      (repository.findByIdempotencyKey as jest.Mock).mockResolvedValueOnce(existingProperty);

      const result = await service.createProperty(
        mockUserId,
        validDto,
        'idem-key-123',
      );

      expect(result.isNew).toBe(false);
      expect(result.property.id).toBe(mockPropertyId);
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('should store idempotency key after new property creation', async () => {
      (repository.findByIdempotencyKey as jest.Mock).mockResolvedValueOnce(null);
      (dataSource.query as jest.Mock)
        .mockResolvedValueOnce([mockRawRow])
        .mockResolvedValueOnce([]);

      await service.createProperty(mockUserId, validDto, 'idem-key-456');

      expect(dataSource.query).toHaveBeenCalledTimes(2);
      const idempotencyCall = (dataSource.query as jest.Mock).mock.calls[1];
      expect(idempotencyCall[0]).toContain('property_idempotency_keys');
      expect(idempotencyCall[1]).toEqual([mockUserId, mockPropertyId, 'idem-key-456']);
    });

    it('should set locationSource from the DTO value', async () => {
      const manualDto = { ...validDto, locationSource: 'MANUAL' };
      const manualRow = { ...mockRawRow, location_source: 'MANUAL' };
      (dataSource.query as jest.Mock).mockResolvedValueOnce([manualRow]);

      const result = await service.createProperty(mockUserId, manualDto);

      expect(result.property.locationSource).toBe('MANUAL');
    });
  });
});
