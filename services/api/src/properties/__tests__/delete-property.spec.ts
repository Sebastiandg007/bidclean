import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PropertiesService } from '../properties.service';
import { PropertiesController } from '../properties.controller';
import { PropertiesRepository } from '../properties.repository';
import { PropertyPhotoService } from '../photo/property-photo.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import { PropertyOwnerGuard } from '../guards/property-owner.guard';
import { OFFER_EDITABILITY_CHECK, PROPERTY_READINESS_CHECK } from '../contracts/offer-editability.interface';
import { User } from '../../auth/entities/user.entity';
import { JwtUserPayload } from '../../auth/guards/jwt.types';
import { Request } from 'express';

/** Mock guard that always allows access (unit tests isolate controller logic) */
const mockPropertyOwnerGuard = { canActivate: () => true };

describe('DELETE /properties/:id', () => {
  describe('PropertiesService.deleteProperty', () => {
    let service: PropertiesService;
    let repository: { softDelete: jest.Mock };
    let editabilityCheck: { canModifyProperty: jest.Mock };

    const mockUserId = 'user-uuid-1234';
    const mockPropertyId = 'property-uuid-5678';

    beforeEach(async () => {
      repository = {
        softDelete: jest.fn(),
      };

      editabilityCheck = {
        canModifyProperty: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PropertiesService,
          { provide: PropertiesRepository, useValue: repository },
          { provide: PropertyPhotoService, useValue: {} },
          { provide: GeocodingService, useValue: {} },
          { provide: OFFER_EDITABILITY_CHECK, useValue: editabilityCheck },
          { provide: PROPERTY_READINESS_CHECK, useValue: { isOfferReady: jest.fn().mockResolvedValue({ ready: true, reasons: [] }) } },
          { provide: DataSource, useValue: { query: jest.fn() } },
        ],
      }).compile();

      service = module.get<PropertiesService>(PropertiesService);
    });

    it('should soft delete property and return true when editable and owned', async () => {
      editabilityCheck.canModifyProperty.mockResolvedValueOnce({
        editable: true,
        blockedFields: [],
      });
      repository.softDelete.mockResolvedValueOnce(true);

      const result = await service.deleteProperty(mockPropertyId, mockUserId);

      expect(result).toBe(true);
      expect(editabilityCheck.canModifyProperty).toHaveBeenCalledWith(
        mockPropertyId,
        ['delete'],
      );
      expect(repository.softDelete).toHaveBeenCalledWith(mockPropertyId, mockUserId);
    });

    it('should throw ConflictException when offer contract blocks deletion', async () => {
      editabilityCheck.canModifyProperty.mockResolvedValueOnce({
        editable: false,
        blockedFields: ['delete'],
        reason: 'Active offer exists',
      });

      await expect(
        service.deleteProperty(mockPropertyId, mockUserId),
      ).rejects.toThrow(ConflictException);

      expect(repository.softDelete).not.toHaveBeenCalled();
    });

    it('should return false when property not found or not owned', async () => {
      editabilityCheck.canModifyProperty.mockResolvedValueOnce({
        editable: true,
        blockedFields: [],
      });
      repository.softDelete.mockResolvedValueOnce(false);

      const result = await service.deleteProperty(mockPropertyId, mockUserId);

      expect(result).toBe(false);
    });
  });

  describe('PropertiesController.deleteProperty', () => {
    let controller: PropertiesController;
    let propertiesService: { deleteProperty: jest.Mock };
    let userRepository: { findOne: jest.Mock };

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

    beforeEach(async () => {
      propertiesService = {
        deleteProperty: jest.fn(),
      };

      userRepository = {
        findOne: jest.fn(),
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

    it('should return void (204 No Content) on successful delete', async () => {
      userRepository.findOne.mockResolvedValueOnce({ id: mockUserId, keycloakId: mockKeycloakId });
      propertiesService.deleteProperty.mockResolvedValueOnce(true);

      const result = await controller.deleteProperty(mockPropertyId, mockRequest);

      expect(result).toBeUndefined();
      expect(propertiesService.deleteProperty).toHaveBeenCalledWith(
        mockPropertyId,
        mockUserId,
      );
    });

    it('should throw NotFoundException when property not found or not owned', async () => {
      userRepository.findOne.mockResolvedValueOnce({ id: mockUserId, keycloakId: mockKeycloakId });
      propertiesService.deleteProperty.mockResolvedValueOnce(false);

      await expect(
        controller.deleteProperty(mockPropertyId, mockRequest),
      ).rejects.toThrow(NotFoundException);
    });

    it('should propagate ConflictException from service (409 active offers)', async () => {
      userRepository.findOne.mockResolvedValueOnce({ id: mockUserId, keycloakId: mockKeycloakId });
      propertiesService.deleteProperty.mockRejectedValueOnce(
        new ConflictException('property.error.has_active_offer'),
      );

      await expect(
        controller.deleteProperty(mockPropertyId, mockRequest),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException when user is not found by keycloakId', async () => {
      userRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        controller.deleteProperty(mockPropertyId, mockRequest),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
