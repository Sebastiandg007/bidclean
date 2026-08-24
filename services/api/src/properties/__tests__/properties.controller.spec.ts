import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PropertiesController } from '../properties.controller';
import { PropertiesService, CreatePropertyResult } from '../properties.service';
import { PropertyPhotoService } from '../photo/property-photo.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import { PropertyOwnerGuard } from '../guards/property-owner.guard';
import { User } from '../../auth/entities/user.entity';
import { Property } from '../entities/property.entity';
import { CreatePropertyDto } from '../dto/create-property.dto';
import { JwtUserPayload } from '../../auth/guards/jwt.types';
import { OwnerPropertyView } from '../properties.types';
import { Request, Response } from 'express';

/** Mock guard that always allows access (unit tests isolate controller logic) */
const mockPropertyOwnerGuard = { canActivate: () => true };

describe('PropertiesController', () => {
  let controller: PropertiesController;
  let propertiesService: jest.Mocked<Partial<PropertiesService>>;
  let userRepository: { findOne: jest.Mock };
  let mockResponse: Partial<Response>;

  const mockKeycloakId = 'keycloak-uuid-abc';
  const mockUserId = 'user-uuid-1234';
  const mockPropertyId = 'property-uuid-5678';

  const mockJwtPayload: JwtUserPayload = {
    keycloakId: mockKeycloakId,
    email: 'host@test.com',
    emailVerified: true,
  };

  const mockRequest = {
    user: mockJwtPayload,
  } as unknown as Request & { user: JwtUserPayload };

  const validDto: CreatePropertyDto = {
    name: 'Test Apartment',
    type: 'apartment',
    addressStreet: '123 Main St',
    addressCity: 'Bogota',
    addressCountry: 'CO',
    lat: 4.711,
    lng: -74.0721,
    locationSource: 'GEOCODED',
    squareMeters: 80,
    bedrooms: 2,
    bathrooms: 1,
  };

  const mockProperty: Partial<Property> = {
    id: mockPropertyId,
    userId: mockUserId,
    name: validDto.name,
    type: validDto.type,
    addressStreet: validDto.addressStreet,
    addressCity: validDto.addressCity,
    addressCountry: validDto.addressCountry,
    locationSource: 'GEOCODED',
    squareMeters: 80,
    bedrooms: 2,
    bathrooms: 1,
  };

  const mockOwnerView: OwnerPropertyView = {
    id: mockPropertyId,
    userId: mockUserId,
    name: 'Test Apartment',
    type: 'apartment',
    description: 'A nice apartment',
    address: {
      street: '123 Main St',
      city: 'Bogota',
      state: null,
      postalCode: null,
      country: 'CO',
    },
    formattedAddress: '123 Main St, Bogota, Colombia',
    location: { lat: 4.711, lng: -74.0721 },
    locationSource: 'GEOCODED',
    dimensions: {
      squareMeters: 80,
      bedrooms: 2,
      bathrooms: 1,
      floorNumber: null,
    },
    amenities: {
      hasParking: true,
      hasElevator: false,
      specialRequirements: [],
    },
    checklistItems: ['Clean kitchen', 'Vacuum floors'],
    accessInstructions: 'Ring bell twice',
    photos: [
      {
        id: 'photo-1',
        url: 'https://minio.local/photo1.jpg?signed=abc',
        mimeType: 'image/jpeg',
        fileSizeBytes: 245000,
        displayOrder: 0,
      },
      {
        id: 'photo-2',
        url: 'https://minio.local/photo2.png?signed=def',
        mimeType: 'image/png',
        fileSizeBytes: 180000,
        displayOrder: 1,
      },
    ],
    isOfferReady: true,
    createdAt: new Date('2024-01-15T10:00:00Z'),
    updatedAt: new Date('2024-01-20T14:30:00Z'),
  };

  beforeEach(async () => {
    propertiesService = {
      createProperty: jest.fn(),
      getPropertyDetail: jest.fn(),
    };

    userRepository = {
      findOne: jest.fn(),
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PropertiesController],
      providers: [
        { provide: PropertiesService, useValue: propertiesService },
        { provide: PropertyPhotoService, useValue: {} },
        { provide: GeocodingService, useValue: {} },
        { provide: getRepositoryToken(User), useValue: userRepository },
      ],
    })
      .overrideGuard(PropertyOwnerGuard)
      .useValue(mockPropertyOwnerGuard)
      .compile();

    controller = module.get<PropertiesController>(PropertiesController);
  });

  describe('POST /properties', () => {
    it('should create a property and set status 201 for new creation', async () => {
      userRepository.findOne.mockResolvedValueOnce({ id: mockUserId, keycloakId: mockKeycloakId });
      (propertiesService.createProperty as jest.Mock).mockResolvedValueOnce({
        property: mockProperty,
        isNew: true,
      } as CreatePropertyResult);

      const result = await controller.createProperty(
        validDto,
        undefined,
        mockRequest,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CREATED);
      expect(result.id).toBe(mockPropertyId);
      expect(propertiesService.createProperty).toHaveBeenCalledWith(
        mockUserId,
        validDto,
        undefined,
      );
    });

    it('should return status 200 for idempotent duplicate with Idempotency-Key', async () => {
      userRepository.findOne.mockResolvedValueOnce({ id: mockUserId, keycloakId: mockKeycloakId });
      (propertiesService.createProperty as jest.Mock).mockResolvedValueOnce({
        property: mockProperty,
        isNew: false,
      } as CreatePropertyResult);

      const result = await controller.createProperty(
        validDto,
        'my-idempotency-key',
        mockRequest,
        mockResponse as Response,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(result.id).toBe(mockPropertyId);
      expect(propertiesService.createProperty).toHaveBeenCalledWith(
        mockUserId,
        validDto,
        'my-idempotency-key',
      );
    });

    it('should throw NotFoundException when user is not found by keycloakId', async () => {
      userRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        controller.createProperty(validDto, undefined, mockRequest, mockResponse as Response),
      ).rejects.toThrow(NotFoundException);
    });

    it('should pass the idempotency key from header to the service', async () => {
      userRepository.findOne.mockResolvedValueOnce({ id: mockUserId, keycloakId: mockKeycloakId });
      (propertiesService.createProperty as jest.Mock).mockResolvedValueOnce({
        property: mockProperty,
        isNew: true,
      } as CreatePropertyResult);

      await controller.createProperty(
        validDto,
        'unique-key-789',
        mockRequest,
        mockResponse as Response,
      );

      expect(propertiesService.createProperty).toHaveBeenCalledWith(
        mockUserId,
        validDto,
        'unique-key-789',
      );
    });
  });

  describe('GET /properties/:id', () => {
    it('should return full property detail for the owner', async () => {
      userRepository.findOne.mockResolvedValueOnce({ id: mockUserId, keycloakId: mockKeycloakId });
      (propertiesService.getPropertyDetail as jest.Mock).mockResolvedValueOnce(mockOwnerView);

      const result = await controller.getPropertyDetail(mockPropertyId, mockRequest);

      expect(result).toEqual(mockOwnerView);
      expect(propertiesService.getPropertyDetail).toHaveBeenCalledWith(
        mockPropertyId,
        mockUserId,
      );
    });

    it('should throw NotFoundException when property is not found', async () => {
      userRepository.findOne.mockResolvedValueOnce({ id: mockUserId, keycloakId: mockKeycloakId });
      (propertiesService.getPropertyDetail as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        controller.getPropertyDetail(mockPropertyId, mockRequest),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when user is not found', async () => {
      userRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        controller.getPropertyDetail(mockPropertyId, mockRequest),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return photos with signed URLs ordered by display_order', async () => {
      userRepository.findOne.mockResolvedValueOnce({ id: mockUserId, keycloakId: mockKeycloakId });
      (propertiesService.getPropertyDetail as jest.Mock).mockResolvedValueOnce(mockOwnerView);

      const result = await controller.getPropertyDetail(mockPropertyId, mockRequest);

      expect(result.photos).toHaveLength(2);
      expect(result.photos[0]!.displayOrder).toBe(0);
      expect(result.photos[1]!.displayOrder).toBe(1);
      expect(result.photos[0]!.url).toContain('signed');
      expect(result.photos[1]!.url).toContain('signed');
    });

    it('should return correct offer-readiness status', async () => {
      userRepository.findOne.mockResolvedValueOnce({ id: mockUserId, keycloakId: mockKeycloakId });
      (propertiesService.getPropertyDetail as jest.Mock).mockResolvedValueOnce(mockOwnerView);

      const result = await controller.getPropertyDetail(mockPropertyId, mockRequest);

      expect(result.isOfferReady).toBe(true);
    });

    it('should return all private fields (street, state, access_instructions)', async () => {
      userRepository.findOne.mockResolvedValueOnce({ id: mockUserId, keycloakId: mockKeycloakId });
      (propertiesService.getPropertyDetail as jest.Mock).mockResolvedValueOnce(mockOwnerView);

      const result = await controller.getPropertyDetail(mockPropertyId, mockRequest);

      expect(result.address.street).toBe('123 Main St');
      expect(result.formattedAddress).toBe('123 Main St, Bogota, Colombia');
      expect(result.accessInstructions).toBe('Ring bell twice');
      expect(result.location).toEqual({ lat: 4.711, lng: -74.0721 });
      expect(result.locationSource).toBe('GEOCODED');
    });
  });
});
