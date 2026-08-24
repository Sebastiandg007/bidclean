import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PropertiesService, CreatePropertyResult } from '../properties.service';
import { PropertiesRepository } from '../properties.repository';
import { PropertyPhotoService } from '../photo/property-photo.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import { OFFER_EDITABILITY_CHECK, PROPERTY_READINESS_CHECK } from '../contracts/offer-editability.interface';
import { CreatePropertyDto } from '../dto/create-property.dto';
import { UpdatePropertyDto } from '../dto/update-property.dto';
import { PropertyQueryDto } from '../dto/property-query.dto';
import { Property } from '../entities/property.entity';
import { PropertyPhoto } from '../entities/property-photo.entity';

describe('PropertiesService', () => {
  let service: PropertiesService;
  let repository: jest.Mocked<Partial<PropertiesRepository>>;
  let photoService: jest.Mocked<Partial<PropertyPhotoService>>;
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
      findAllByOwner: jest.fn(),
      getCoverPhoto: jest.fn(),
    };

    photoService = {
      getSignedUrl: jest.fn(),
    };

    dataSource = {
      query: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PropertiesService,
        { provide: PropertiesRepository, useValue: repository },
        { provide: PropertyPhotoService, useValue: photoService },
        { provide: GeocodingService, useValue: {} },
        { provide: OFFER_EDITABILITY_CHECK, useValue: { canModifyProperty: jest.fn() } },
        { provide: PROPERTY_READINESS_CHECK, useValue: { isOfferReady: jest.fn().mockResolvedValue({ ready: true, reasons: [] }) } },
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

  describe('listProperties', () => {
    const createMockProperty = (overrides?: Partial<Property>): Property => {
      const property = new Property();
      property.id = mockPropertyId;
      property.userId = mockUserId;
      property.name = 'Test Apartment';
      property.type = 'apartment';
      property.description = 'A nice place';
      property.addressStreet = '123 Main St';
      property.addressCity = 'Bogota';
      property.addressState = 'Cundinamarca';
      property.addressPostalCode = '110111';
      property.addressCountry = 'CO';
      property.location = '0101000020E6100000';
      property.formattedAddress = '123 Main St, Bogota';
      property.locationSource = 'GEOCODED';
      property.squareMeters = 80;
      property.bedrooms = 2;
      property.bathrooms = 1;
      property.floorNumber = 3;
      property.hasParking = true;
      property.hasElevator = true;
      property.specialRequirements = [];
      property.checklistItems = [];
      property.accessInstructions = null;
      property.deletedAt = null;
      property.createdAt = new Date('2024-01-01T00:00:00Z');
      property.updatedAt = new Date('2024-01-01T00:00:00Z');
      property.photos = [];
      Object.assign(property, overrides);
      return property;
    };

    const defaultQuery: PropertyQueryDto = {
      page: 1,
      pageSize: 20,
      sortBy: 'updated_at',
      sortOrder: 'DESC',
    };

    it('should return a paginated list of property items', async () => {
      const mockProperty = createMockProperty({ photos: [{ id: 'photo-1' } as PropertyPhoto] });
      (repository.findAllByOwner as jest.Mock).mockResolvedValueOnce({
        items: [mockProperty],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
      (repository.getCoverPhoto as jest.Mock).mockResolvedValueOnce(null);

      const result = await service.listProperties(mockUserId, defaultQuery);

      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.items).toHaveLength(1);

      const item = result.items[0]!;
      expect(item.id).toBe(mockPropertyId);
      expect(item.name).toBe('Test Apartment');
      expect(item.type).toBe('apartment');
      expect(item.city).toBe('Bogota');
      expect(item.country).toBe('CO');
    });

    it('should resolve cover photo signed URL when a cover photo exists', async () => {
      const mockPhoto = new PropertyPhoto();
      mockPhoto.id = 'photo-1';
      mockPhoto.storageKey = 'prop-1/photo-1.jpg';
      mockPhoto.displayOrder = 0;

      const mockProperty = createMockProperty({ photos: [mockPhoto] });
      (repository.findAllByOwner as jest.Mock).mockResolvedValueOnce({
        items: [mockProperty],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
      (repository.getCoverPhoto as jest.Mock).mockResolvedValueOnce(mockPhoto);
      (photoService.getSignedUrl as jest.Mock).mockResolvedValueOnce({
        url: 'https://storage.example.com/signed-url',
        expiresAt: new Date(),
      });

      const result = await service.listProperties(mockUserId, defaultQuery);

      const item = result.items[0]!;
      expect(item.coverPhotoUrl).toBe('https://storage.example.com/signed-url');
      expect(repository.getCoverPhoto).toHaveBeenCalledWith(mockPropertyId);
      expect(photoService.getSignedUrl).toHaveBeenCalledWith('prop-1/photo-1.jpg');
    });

    it('should return null coverPhotoUrl when no cover photo exists', async () => {
      const mockProperty = createMockProperty({ photos: [{ id: 'photo-1' } as PropertyPhoto] });
      (repository.findAllByOwner as jest.Mock).mockResolvedValueOnce({
        items: [mockProperty],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
      (repository.getCoverPhoto as jest.Mock).mockResolvedValueOnce(null);

      const result = await service.listProperties(mockUserId, defaultQuery);

      expect(result.items[0]!.coverPhotoUrl).toBeNull();
    });

    it('should calculate isOfferReady=true when all required fields present and has photos', async () => {
      const mockPhoto = new PropertyPhoto();
      mockPhoto.id = 'photo-1';
      const mockProperty = createMockProperty({ photos: [mockPhoto] });
      (repository.findAllByOwner as jest.Mock).mockResolvedValueOnce({
        items: [mockProperty],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
      (repository.getCoverPhoto as jest.Mock).mockResolvedValueOnce(null);

      const result = await service.listProperties(mockUserId, defaultQuery);

      expect(result.items[0]!.isOfferReady).toBe(true);
    });

    it('should calculate isOfferReady=false when property has no photos', async () => {
      const mockProperty = createMockProperty({ photos: [] });
      (repository.findAllByOwner as jest.Mock).mockResolvedValueOnce({
        items: [mockProperty],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
      (repository.getCoverPhoto as jest.Mock).mockResolvedValueOnce(null);

      const result = await service.listProperties(mockUserId, defaultQuery);

      expect(result.items[0]!.isOfferReady).toBe(false);
    });

    it('should calculate isOfferReady=false when required fields are missing', async () => {
      const mockPhoto = new PropertyPhoto();
      mockPhoto.id = 'photo-1';
      const mockProperty = createMockProperty({
        photos: [mockPhoto],
        addressStreet: '',
      });
      (repository.findAllByOwner as jest.Mock).mockResolvedValueOnce({
        items: [mockProperty],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
      (repository.getCoverPhoto as jest.Mock).mockResolvedValueOnce(null);

      const result = await service.listProperties(mockUserId, defaultQuery);

      expect(result.items[0]!.isOfferReady).toBe(false);
    });

    it('should return empty items when user has no properties', async () => {
      (repository.findAllByOwner as jest.Mock).mockResolvedValueOnce({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      });

      const result = await service.listProperties(mockUserId, defaultQuery);

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should pass search and type filter to repository', async () => {
      const queryWithFilters: PropertyQueryDto = {
        page: 2,
        pageSize: 10,
        search: 'Bogota',
        type: 'apartment',
        sortBy: 'name',
        sortOrder: 'ASC',
      };
      (repository.findAllByOwner as jest.Mock).mockResolvedValueOnce({
        items: [],
        total: 0,
        page: 2,
        pageSize: 10,
        totalPages: 0,
      });

      await service.listProperties(mockUserId, queryWithFilters);

      expect(repository.findAllByOwner).toHaveBeenCalledWith(mockUserId, {
        page: 2,
        pageSize: 10,
        search: 'Bogota',
        type: 'apartment',
        sortBy: 'name',
      });
    });
  });

  describe('updateProperty', () => {
    let editabilityCheck: { canModifyProperty: jest.Mock };
    let geocodingService: { forwardGeocode: jest.Mock; reverseGeocode: jest.Mock };

    const mockPropertyWithCoords = {
      id: mockPropertyId,
      userId: mockUserId,
      name: 'Test Apartment',
      type: 'apartment',
      description: 'A cozy apartment',
      addressStreet: '123 Main St',
      addressCity: 'Bogota',
      addressState: 'Cundinamarca',
      addressPostalCode: '110111',
      addressCountry: 'CO',
      location: '0101000020E6100000',
      formattedAddress: '123 Main St, Bogota, Colombia',
      locationSource: 'GEOCODED',
      squareMeters: 80,
      bedrooms: 2,
      bathrooms: 1,
      floorNumber: 3,
      hasParking: true,
      hasElevator: true,
      specialRequirements: ['pets'],
      checklistItems: ['Clean kitchen'],
      accessInstructions: 'Ring bell twice',
      deletedAt: null,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
      photos: [],
      lat: 4.711,
      lng: -74.0721,
    } as unknown as Property & { lat: number; lng: number };

    beforeEach(async () => {
      editabilityCheck = { canModifyProperty: jest.fn() };
      geocodingService = { forwardGeocode: jest.fn(), reverseGeocode: jest.fn() };

      repository = {
        findByIdempotencyKey: jest.fn(),
        findAllByOwner: jest.fn(),
        getCoverPhoto: jest.fn(),
        findOneByOwner: jest.fn(),
        findOneByOwnerWithCoordinates: jest.fn(),
        updateProperty: jest.fn(),
        updatePropertyWithLocation: jest.fn(),
        countPhotos: jest.fn(),
      };

      photoService = {
        getSignedUrl: jest.fn(),
        getPhotosWithUrls: jest.fn(),
      };

      dataSource = {
        query: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PropertiesService,
          { provide: PropertiesRepository, useValue: repository },
          { provide: PropertyPhotoService, useValue: photoService },
          { provide: GeocodingService, useValue: geocodingService },
          { provide: OFFER_EDITABILITY_CHECK, useValue: editabilityCheck },
          { provide: PROPERTY_READINESS_CHECK, useValue: { isOfferReady: jest.fn().mockResolvedValue({ ready: true, reasons: [] }) } },
          { provide: DataSource, useValue: dataSource },
        ],
      }).compile();

      service = module.get<PropertiesService>(PropertiesService);
    });

    it('should throw ConflictException when editability check returns editable=false', async () => {
      editabilityCheck.canModifyProperty.mockResolvedValueOnce({
        editable: false,
        blockedFields: ['name', 'type'],
        reason: 'Active offer in progress',
      });

      const dto: UpdatePropertyDto = { name: 'New Name' };

      await expect(
        service.updateProperty(mockPropertyId, mockUserId, dto),
      ).rejects.toThrow(ConflictException);
    });

    it('should apply simple update when no address or coordinate change', async () => {
      editabilityCheck.canModifyProperty.mockResolvedValueOnce({
        editable: true,
        blockedFields: [],
      });

      const updatedProperty = { ...mockPropertyWithCoords, name: 'Updated Name' };
      (repository.updateProperty as jest.Mock).mockResolvedValueOnce(updatedProperty);
      (repository.findOneByOwnerWithCoordinates as jest.Mock).mockResolvedValueOnce(updatedProperty);
      (photoService.getPhotosWithUrls as jest.Mock).mockResolvedValueOnce([]);

      const dto: UpdatePropertyDto = { name: 'Updated Name' };

      const result = await service.updateProperty(mockPropertyId, mockUserId, dto);

      expect(result).not.toBeNull();
      expect(repository.updateProperty).toHaveBeenCalledWith(
        mockPropertyId,
        mockUserId,
        expect.objectContaining({ name: 'Updated Name' }),
      );
    });

    it('should trigger forward geocoding when address fields change', async () => {
      editabilityCheck.canModifyProperty.mockResolvedValueOnce({
        editable: true,
        blockedFields: [],
      });

      (repository.findOneByOwnerWithCoordinates as jest.Mock).mockResolvedValue(mockPropertyWithCoords);
      geocodingService.forwardGeocode.mockResolvedValueOnce({
        lat: 4.72,
        lng: -74.08,
        formattedAddress: '456 New Street, Bogota, Colombia',
        confidence: 0.95,
      });
      (repository.updatePropertyWithLocation as jest.Mock).mockResolvedValueOnce(mockPropertyWithCoords);
      (photoService.getPhotosWithUrls as jest.Mock).mockResolvedValueOnce([]);

      const dto: UpdatePropertyDto = { addressStreet: '456 New Street' };

      await service.updateProperty(mockPropertyId, mockUserId, dto);

      expect(geocodingService.forwardGeocode).toHaveBeenCalled();
      expect(repository.updatePropertyWithLocation).toHaveBeenCalledWith(
        mockPropertyId,
        mockUserId,
        expect.objectContaining({
          addressStreet: '456 New Street',
          locationSource: 'GEOCODED',
          formattedAddress: '456 New Street, Bogota, Colombia',
        }),
        { lat: 4.72, lng: -74.08 },
      );
    });

    it('should set location_source to MANUAL when coordinates change directly', async () => {
      editabilityCheck.canModifyProperty.mockResolvedValueOnce({
        editable: true,
        blockedFields: [],
      });

      (repository.findOneByOwnerWithCoordinates as jest.Mock).mockResolvedValue(mockPropertyWithCoords);
      (repository.updatePropertyWithLocation as jest.Mock).mockResolvedValueOnce(mockPropertyWithCoords);
      (photoService.getPhotosWithUrls as jest.Mock).mockResolvedValueOnce([]);

      const dto: UpdatePropertyDto = { lat: 5.0, lng: -75.0 };

      await service.updateProperty(mockPropertyId, mockUserId, dto);

      expect(repository.updatePropertyWithLocation).toHaveBeenCalledWith(
        mockPropertyId,
        mockUserId,
        expect.objectContaining({ locationSource: 'MANUAL' }),
        { lat: 5.0, lng: -75.0 },
      );
      expect(geocodingService.forwardGeocode).not.toHaveBeenCalled();
    });

    it('should apply address update without coordinates when geocoding fails (non-blocking)', async () => {
      editabilityCheck.canModifyProperty.mockResolvedValueOnce({
        editable: true,
        blockedFields: [],
      });

      (repository.findOneByOwnerWithCoordinates as jest.Mock).mockResolvedValue(mockPropertyWithCoords);
      geocodingService.forwardGeocode.mockResolvedValueOnce(null);
      const updatedProperty = { ...mockPropertyWithCoords, addressCity: 'Medellin' };
      (repository.updateProperty as jest.Mock).mockResolvedValueOnce(updatedProperty);
      (photoService.getPhotosWithUrls as jest.Mock).mockResolvedValueOnce([]);

      const dto: UpdatePropertyDto = { addressCity: 'Medellin' };

      const result = await service.updateProperty(mockPropertyId, mockUserId, dto);

      expect(result).not.toBeNull();
      expect(repository.updateProperty).toHaveBeenCalled();
      expect(repository.updatePropertyWithLocation).not.toHaveBeenCalled();
    });

    it('should return null when property not found during coordinate update', async () => {
      editabilityCheck.canModifyProperty.mockResolvedValueOnce({
        editable: true,
        blockedFields: [],
      });

      (repository.findOneByOwnerWithCoordinates as jest.Mock).mockResolvedValueOnce(null);

      const dto: UpdatePropertyDto = { lat: 5.0, lng: -75.0 };

      const result = await service.updateProperty(mockPropertyId, mockUserId, dto);

      expect(result).toBeNull();
    });

    it('should return current property detail when no fields are provided', async () => {
      (repository.findOneByOwnerWithCoordinates as jest.Mock).mockResolvedValueOnce(mockPropertyWithCoords);
      (photoService.getPhotosWithUrls as jest.Mock).mockResolvedValueOnce([]);

      const dto: UpdatePropertyDto = {};

      const result = await service.updateProperty(mockPropertyId, mockUserId, dto);

      expect(editabilityCheck.canModifyProperty).not.toHaveBeenCalled();
      expect(result).not.toBeNull();
    });

    it('should use existing coordinates when only lat is provided (fills lng from existing)', async () => {
      editabilityCheck.canModifyProperty.mockResolvedValueOnce({
        editable: true,
        blockedFields: [],
      });

      (repository.findOneByOwnerWithCoordinates as jest.Mock).mockResolvedValue(mockPropertyWithCoords);
      (repository.updatePropertyWithLocation as jest.Mock).mockResolvedValueOnce(mockPropertyWithCoords);
      (photoService.getPhotosWithUrls as jest.Mock).mockResolvedValueOnce([]);

      const dto: UpdatePropertyDto = { lat: 5.5 };

      await service.updateProperty(mockPropertyId, mockUserId, dto);

      expect(repository.updatePropertyWithLocation).toHaveBeenCalledWith(
        mockPropertyId,
        mockUserId,
        expect.objectContaining({ locationSource: 'MANUAL' }),
        { lat: 5.5, lng: mockPropertyWithCoords.lng },
      );
    });
  });
});
