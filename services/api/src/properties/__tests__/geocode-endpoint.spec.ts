import { Test, TestingModule } from '@nestjs/testing';
import {
  HttpException,
  HttpStatus,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PropertiesController } from '../properties.controller';
import { PropertiesService } from '../properties.service';
import { PropertyPhotoService } from '../photo/property-photo.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import { PropertyOwnerGuard } from '../guards/property-owner.guard';
import { User } from '../../auth/entities/user.entity';
import { ForwardGeocodeDto } from '../dto/geocode-request.dto';
import { ForwardGeocodeResponse } from '../geocoding/geocoding.types';
import { JwtUserPayload } from '../../auth/guards/jwt.types';
import { Request } from 'express';

/** Mock guard that always allows access (unit tests isolate controller logic) */
const mockPropertyOwnerGuard = { canActivate: () => true };

describe('PropertiesController — POST /properties/geocode', () => {
  let controller: PropertiesController;
  let geocodingService: { forwardGeocode: jest.Mock };
  let userRepository: { findOne: jest.Mock };

  const mockKeycloakId = 'keycloak-uuid-abc';
  const mockUserId = 'user-uuid-1234';

  const mockJwtPayload: JwtUserPayload = {
    keycloakId: mockKeycloakId,
    email: 'host@test.com',
    emailVerified: true,
  };

  const mockRequest = {
    user: mockJwtPayload,
  } as unknown as Request & { user: JwtUserPayload };

  beforeEach(async () => {
    geocodingService = {
      forwardGeocode: jest.fn(),
    };

    userRepository = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PropertiesController],
      providers: [
        { provide: PropertiesService, useValue: { listProperties: jest.fn() } },
        { provide: PropertyPhotoService, useValue: {} },
        { provide: GeocodingService, useValue: geocodingService },
        { provide: getRepositoryToken(User), useValue: userRepository },
      ],
    })
      .overrideGuard(PropertyOwnerGuard)
      .useValue(mockPropertyOwnerGuard)
      .compile();

    controller = module.get<PropertiesController>(PropertiesController);
  });

  it('should return lat/lng/formattedAddress/confidence on successful geocoding', async () => {
    const expectedResponse: ForwardGeocodeResponse = {
      lat: 4.711,
      lng: -74.0721,
      formattedAddress: 'Calle 123, Bogotá, Colombia',
      confidence: 0.95,
    };

    userRepository.findOne.mockResolvedValueOnce({ id: mockUserId, keycloakId: mockKeycloakId });
    geocodingService.forwardGeocode.mockResolvedValueOnce(expectedResponse);

    const dto: ForwardGeocodeDto = { address: 'Calle 123 Bogota', country: 'CO' };
    const result = await controller.geocodeAddress(dto, mockRequest);

    expect(result).toEqual(expectedResponse);
    expect(geocodingService.forwardGeocode).toHaveBeenCalledWith(
      { address: 'Calle 123 Bogota', country: 'CO' },
      mockUserId,
    );
  });

  it('should throw 422 UnprocessableEntityException when geocoding returns null', async () => {
    userRepository.findOne.mockResolvedValueOnce({ id: mockUserId, keycloakId: mockKeycloakId });
    geocodingService.forwardGeocode.mockResolvedValueOnce(null);

    const dto: ForwardGeocodeDto = { address: 'Unknown address XYZ', country: 'CO' };

    await expect(controller.geocodeAddress(dto, mockRequest)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('should propagate 429 HttpException when rate limit is exceeded', async () => {
    userRepository.findOne.mockResolvedValueOnce({ id: mockUserId, keycloakId: mockKeycloakId });
    geocodingService.forwardGeocode.mockRejectedValueOnce(
      new HttpException(
        'Geocoding rate limit exceeded. Please wait before making more requests.',
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );

    const dto: ForwardGeocodeDto = { address: 'Some address', country: 'CO' };

    try {
      await controller.geocodeAddress(dto, mockRequest);
      fail('Expected HttpException to be thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
  });

  it('should throw NotFoundException when user is not found', async () => {
    userRepository.findOne.mockResolvedValueOnce(null);

    const dto: ForwardGeocodeDto = { address: 'Test address', country: 'US' };

    await expect(controller.geocodeAddress(dto, mockRequest)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should call geocodingService with the correct userId from resolved user', async () => {
    const differentUserId = 'different-user-uuid-9999';
    userRepository.findOne.mockResolvedValueOnce({ id: differentUserId, keycloakId: mockKeycloakId });
    geocodingService.forwardGeocode.mockResolvedValueOnce({
      lat: 40.7128,
      lng: -74.006,
      formattedAddress: 'New York, NY, USA',
      confidence: 0.9,
    });

    const dto: ForwardGeocodeDto = { address: 'New York', country: 'US' };
    await controller.geocodeAddress(dto, mockRequest);

    expect(geocodingService.forwardGeocode).toHaveBeenCalledWith(
      { address: 'New York', country: 'US' },
      differentUserId,
    );
  });
});
