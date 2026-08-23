import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PropertiesController } from '../properties.controller';
import { PropertiesService, CreatePropertyResult } from '../properties.service';
import { PropertyPhotoService } from '../photo/property-photo.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import { User } from '../../auth/entities/user.entity';
import { Property } from '../entities/property.entity';
import { CreatePropertyDto } from '../dto/create-property.dto';
import { JwtUserPayload } from '../../auth/guards/jwt.types';
import { Request, Response } from 'express';

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

  beforeEach(async () => {
    propertiesService = {
      createProperty: jest.fn(),
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
    }).compile();

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
});
