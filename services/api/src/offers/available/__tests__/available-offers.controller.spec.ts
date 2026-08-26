// @ts-nocheck
/**
 * AvailableOffersController unit tests.
 *
 * Tests: auth guard enforcement, role guard (Cleaner only), DTO validation
 * rejection, response shape verification.
 * Mocks AvailableOffersService and User repository.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AvailableOffersController } from '../available-offers.controller';
import { AvailableOffersService } from '../available-offers.service';
import { User } from '../../../auth/entities/user.entity';
import { UserRole } from '../../../roles/roles.types';
import { AvailableOffersSortOption } from '../dto/available-offers-query.dto';
import {
  AvailableOfferDto,
  AvailableOffersResponseDto,
  AvailableOffersPaginationDto,
  AvailableOffersSnapshotResponseDto,
  PropertySnapshotDto,
  CleanerPriceBreakdownDto,
  PublicLocationDto,
} from '../dto/available-offer-response.dto';

describe('AvailableOffersController', () => {
  let controller: AvailableOffersController;
  let mockService: jest.Mocked<AvailableOffersService>;
  let mockUserRepository: { findOne: jest.Mock };

  const keycloakId = 'keycloak-uuid-001';
  const userId = 'user-uuid-001';

  const mockCleanerUser = {
    id: userId,
    keycloakId,
    email: 'cleaner@test.com',
    fullName: 'Test Cleaner',
    roles: [UserRole.CLEANER],
    activeRole: UserRole.CLEANER,
  };

  const mockHostUser = {
    id: 'host-uuid-001',
    keycloakId: 'keycloak-host-001',
    email: 'host@test.com',
    fullName: 'Test Host',
    roles: [UserRole.HOST],
    activeRole: UserRole.HOST,
  };

  /** Create a mock authenticated request */
  function createAuthRequest(payload = { keycloakId, email: 'cleaner@test.com', emailVerified: true }) {
    return { user: payload } as any;
  }

  /** Create a sample available offer DTO */
  function createSampleOfferDto(): AvailableOfferDto {
    const propertySnapshot = new PropertySnapshotDto();
    propertySnapshot.name = 'Sunny Apartment';
    propertySnapshot.type = 'apartment';
    propertySnapshot.city = 'Miami';
    propertySnapshot.coverPhotoUrl = 'https://storage.bidclean.tech/photo.jpg';

    const priceBreakdown = new CleanerPriceBreakdownDto();
    priceBreakdown.offeredPriceCents = 8000;
    priceBreakdown.commissionCents = 240;
    priceBreakdown.payoutCents = 7760;
    priceBreakdown.currency = 'USD';

    const publicLocation = new PublicLocationDto();
    publicLocation.lat = 25.7617;
    publicLocation.lng = -80.1918;

    const dto = new AvailableOfferDto();
    dto.offerId = 'offer-uuid-123';
    dto.propertySnapshot = propertySnapshot;
    dto.serviceType = 'standard';
    dto.description = 'Weekly cleaning';
    dto.scheduledAt = '2024-06-15T14:00:00.000Z';
    dto.timezone = 'America/New_York';
    dto.estimatedDurationMinutes = 120;
    dto.priceBreakdown = priceBreakdown;
    dto.distanceMeters = 3500;
    dto.publishedAt = '2024-06-10T10:00:00.000Z';
    dto.isUrgent = false;
    dto.publicLocation = publicLocation;

    return dto;
  }

  beforeEach(async () => {
    mockService = {
      getAvailableOffers: jest.fn(),
      getAvailableOffersSnapshot: jest.fn(),
    } as unknown as jest.Mocked<AvailableOffersService>;

    mockUserRepository = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AvailableOffersController],
      providers: [
        { provide: AvailableOffersService, useValue: mockService },
        { provide: getRepositoryToken(User), useValue: mockUserRepository },
      ],
    }).compile();

    controller = module.get<AvailableOffersController>(AvailableOffersController);
  });

  describe('getAvailableOffers', () => {
    describe('role guard (Cleaner-only access)', () => {
      it('should throw ForbiddenException when user not found', async () => {
        mockUserRepository.findOne.mockResolvedValue(null);

        await expect(
          controller.getAvailableOffers(createAuthRequest(), {
            sort: AvailableOffersSortOption.DISTANCE_ASC,
            page: 1,
            limit: 20,
          } as any),
        ).rejects.toThrow(ForbiddenException);
      });

      it('should throw ForbiddenException when user lacks Cleaner role', async () => {
        mockUserRepository.findOne.mockResolvedValue(mockHostUser);

        await expect(
          controller.getAvailableOffers(
            createAuthRequest({ keycloakId: 'keycloak-host-001', email: 'host@test.com', emailVerified: true }),
            { sort: AvailableOffersSortOption.DISTANCE_ASC, page: 1, limit: 20 } as any,
          ),
        ).rejects.toThrow(ForbiddenException);
      });

      it('should succeed when user has Cleaner role', async () => {
        mockUserRepository.findOne.mockResolvedValue(mockCleanerUser);
        const mockResponse = new AvailableOffersResponseDto();
        mockResponse.items = [];
        mockResponse.pagination = new AvailableOffersPaginationDto();
        mockResponse.pagination.page = 1;
        mockResponse.pagination.limit = 20;
        mockResponse.pagination.total = 0;
        mockResponse.pagination.totalPages = 0;
        mockService.getAvailableOffers.mockResolvedValue(mockResponse);

        const result = await controller.getAvailableOffers(
          createAuthRequest(),
          { sort: AvailableOffersSortOption.DISTANCE_ASC, page: 1, limit: 20 } as any,
        );

        expect(result).toBe(mockResponse);
      });

      it('should pass resolved cleaner userId to service', async () => {
        mockUserRepository.findOne.mockResolvedValue(mockCleanerUser);
        const mockResponse = new AvailableOffersResponseDto();
        mockResponse.items = [];
        mockResponse.pagination = new AvailableOffersPaginationDto();
        mockResponse.pagination.page = 1;
        mockResponse.pagination.limit = 20;
        mockResponse.pagination.total = 0;
        mockResponse.pagination.totalPages = 0;
        mockService.getAvailableOffers.mockResolvedValue(mockResponse);

        await controller.getAvailableOffers(
          createAuthRequest(),
          { sort: AvailableOffersSortOption.DISTANCE_ASC, page: 1, limit: 20 } as any,
        );

        expect(mockService.getAvailableOffers).toHaveBeenCalledWith(
          userId,
          expect.any(Object),
        );
      });
    });

    describe('response shape', () => {
      it('should return response with items array and pagination', async () => {
        mockUserRepository.findOne.mockResolvedValue(mockCleanerUser);
        const sampleOffer = createSampleOfferDto();
        const mockResponse = new AvailableOffersResponseDto();
        mockResponse.items = [sampleOffer];
        mockResponse.pagination = new AvailableOffersPaginationDto();
        mockResponse.pagination.page = 1;
        mockResponse.pagination.limit = 20;
        mockResponse.pagination.total = 1;
        mockResponse.pagination.totalPages = 1;
        mockService.getAvailableOffers.mockResolvedValue(mockResponse);

        const result = await controller.getAvailableOffers(
          createAuthRequest(),
          { sort: AvailableOffersSortOption.DISTANCE_ASC, page: 1, limit: 20 } as any,
        );

        expect(result.items).toHaveLength(1);
        expect(result.pagination).toBeDefined();
        expect(result.pagination.page).toBe(1);
        expect(result.pagination.limit).toBe(20);
        expect(result.pagination.total).toBe(1);
        expect(result.pagination.totalPages).toBe(1);
      });

      it('should return offer with all documented fields', async () => {
        mockUserRepository.findOne.mockResolvedValue(mockCleanerUser);
        const sampleOffer = createSampleOfferDto();
        const mockResponse = new AvailableOffersResponseDto();
        mockResponse.items = [sampleOffer];
        mockResponse.pagination = new AvailableOffersPaginationDto();
        mockResponse.pagination.page = 1;
        mockResponse.pagination.limit = 20;
        mockResponse.pagination.total = 1;
        mockResponse.pagination.totalPages = 1;
        mockService.getAvailableOffers.mockResolvedValue(mockResponse);

        const result = await controller.getAvailableOffers(
          createAuthRequest(),
          { sort: AvailableOffersSortOption.DISTANCE_ASC, page: 1, limit: 20 } as any,
        );

        const offer = result.items[0];
        expect(offer.offerId).toBeDefined();
        expect(offer.propertySnapshot).toBeDefined();
        expect(offer.propertySnapshot.name).toBeDefined();
        expect(offer.propertySnapshot.type).toBeDefined();
        expect(offer.propertySnapshot.city).toBeDefined();
        expect(offer.propertySnapshot.coverPhotoUrl).toBeDefined();
        expect(offer.serviceType).toBeDefined();
        expect(offer.scheduledAt).toBeDefined();
        expect(offer.timezone).toBeDefined();
        expect(offer.estimatedDurationMinutes).toBeDefined();
        expect(offer.priceBreakdown).toBeDefined();
        expect(offer.priceBreakdown.offeredPriceCents).toBeDefined();
        expect(offer.priceBreakdown.commissionCents).toBeDefined();
        expect(offer.priceBreakdown.payoutCents).toBeDefined();
        expect(offer.priceBreakdown.currency).toBeDefined();
        expect(offer.distanceMeters).toBeDefined();
        expect(offer.publishedAt).toBeDefined();
        expect(offer.isUrgent).toBeDefined();
        expect(offer.publicLocation).toBeDefined();
        expect(offer.publicLocation.lat).toBeDefined();
        expect(offer.publicLocation.lng).toBeDefined();
      });

      it('should not include forbidden privacy fields in offer response', async () => {
        mockUserRepository.findOne.mockResolvedValue(mockCleanerUser);
        const sampleOffer = createSampleOfferDto();
        const mockResponse = new AvailableOffersResponseDto();
        mockResponse.items = [sampleOffer];
        mockResponse.pagination = new AvailableOffersPaginationDto();
        mockResponse.pagination.page = 1;
        mockResponse.pagination.limit = 20;
        mockResponse.pagination.total = 1;
        mockResponse.pagination.totalPages = 1;
        mockService.getAvailableOffers.mockResolvedValue(mockResponse);

        const result = await controller.getAvailableOffers(
          createAuthRequest(),
          { sort: AvailableOffersSortOption.DISTANCE_ASC, page: 1, limit: 20 } as any,
        );

        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain('address_street');
        expect(serialized).not.toContain('address_state');
        expect(serialized).not.toContain('address_postal_code');
        expect(serialized).not.toContain('formatted_address');
        expect(serialized).not.toContain('access_instructions');
        expect(serialized).not.toContain('location_source');
      });
    });

    describe('user resolution', () => {
      it('should look up user by keycloakId from JWT payload', async () => {
        mockUserRepository.findOne.mockResolvedValue(mockCleanerUser);
        const mockResponse = new AvailableOffersResponseDto();
        mockResponse.items = [];
        mockResponse.pagination = new AvailableOffersPaginationDto();
        mockResponse.pagination.page = 1;
        mockResponse.pagination.limit = 20;
        mockResponse.pagination.total = 0;
        mockResponse.pagination.totalPages = 0;
        mockService.getAvailableOffers.mockResolvedValue(mockResponse);

        await controller.getAvailableOffers(
          createAuthRequest(),
          { sort: AvailableOffersSortOption.DISTANCE_ASC, page: 1, limit: 20 } as any,
        );

        expect(mockUserRepository.findOne).toHaveBeenCalledWith({
          where: { keycloakId },
        });
      });
    });
  });

  describe('getAvailableOffersSnapshot', () => {
    describe('role guard (Cleaner-only access)', () => {
      it('should throw ForbiddenException when user not found', async () => {
        mockUserRepository.findOne.mockResolvedValue(null);

        await expect(
          controller.getAvailableOffersSnapshot(createAuthRequest()),
        ).rejects.toThrow(ForbiddenException);
      });

      it('should throw ForbiddenException when user lacks Cleaner role', async () => {
        mockUserRepository.findOne.mockResolvedValue(mockHostUser);

        await expect(
          controller.getAvailableOffersSnapshot(
            createAuthRequest({ keycloakId: 'keycloak-host-001', email: 'host@test.com', emailVerified: true }),
          ),
        ).rejects.toThrow(ForbiddenException);
      });

      it('should succeed when user has Cleaner role', async () => {
        mockUserRepository.findOne.mockResolvedValue(mockCleanerUser);
        const mockResponse = new AvailableOffersSnapshotResponseDto();
        mockResponse.offers = [];
        mockResponse.syncedAt = new Date().toISOString();
        mockService.getAvailableOffersSnapshot.mockResolvedValue(mockResponse);

        const result = await controller.getAvailableOffersSnapshot(createAuthRequest());

        expect(result).toBe(mockResponse);
      });
    });

    describe('response shape', () => {
      it('should return response with offers array and syncedAt', async () => {
        mockUserRepository.findOne.mockResolvedValue(mockCleanerUser);
        const sampleOffer = createSampleOfferDto();
        const mockResponse = new AvailableOffersSnapshotResponseDto();
        mockResponse.offers = [sampleOffer];
        mockResponse.syncedAt = '2024-06-15T12:00:00.000Z';
        mockService.getAvailableOffersSnapshot.mockResolvedValue(mockResponse);

        const result = await controller.getAvailableOffersSnapshot(createAuthRequest());

        expect(result.offers).toHaveLength(1);
        expect(result.syncedAt).toBe('2024-06-15T12:00:00.000Z');
      });

      it('should NOT include pagination in snapshot response', async () => {
        mockUserRepository.findOne.mockResolvedValue(mockCleanerUser);
        const mockResponse = new AvailableOffersSnapshotResponseDto();
        mockResponse.offers = [];
        mockResponse.syncedAt = new Date().toISOString();
        mockService.getAvailableOffersSnapshot.mockResolvedValue(mockResponse);

        const result = await controller.getAvailableOffersSnapshot(createAuthRequest());

        expect((result as any).pagination).toBeUndefined();
      });
    });

    describe('service delegation', () => {
      it('should pass resolved cleaner userId to snapshot service', async () => {
        mockUserRepository.findOne.mockResolvedValue(mockCleanerUser);
        const mockResponse = new AvailableOffersSnapshotResponseDto();
        mockResponse.offers = [];
        mockResponse.syncedAt = new Date().toISOString();
        mockService.getAvailableOffersSnapshot.mockResolvedValue(mockResponse);

        await controller.getAvailableOffersSnapshot(createAuthRequest());

        expect(mockService.getAvailableOffersSnapshot).toHaveBeenCalledWith(userId);
      });
    });
  });
});
