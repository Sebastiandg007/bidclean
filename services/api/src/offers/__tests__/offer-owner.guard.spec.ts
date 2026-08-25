import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OfferOwnerGuard } from '../guards/offer-owner.guard';
import { Offer } from '../entities/offer.entity';
import { User } from '../../auth/entities/user.entity';

describe('OfferOwnerGuard', () => {
  let guard: OfferOwnerGuard;

  const mockUserRepository = {
    findOne: jest.fn(),
  };

  const mockOfferRepository = {
    findOne: jest.fn(),
  };

  const KEYCLOAK_ID = 'kc-host-123';
  const USER_ID = 'user-uuid-host';
  const OFFER_ID = 'offer-uuid-1';

  const createMockUser = (overrides: Partial<User> = {}): User =>
    ({
      id: USER_ID,
      keycloakId: KEYCLOAK_ID,
      email: 'host@bidclean.tech',
      fullName: 'Test Host',
      country: 'CO',
      language: 'es',
      isEmailVerified: true,
      roles: ['host'],
      activeRole: 'host',
      onboardingStatusHost: 'COMPLETED',
      onboardingStatusCleaner: 'NOT_STARTED',
      deletionStatus: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      sessions: [],
      biometricCredentials: [],
      ...overrides,
    }) as User;

  const createMockOffer = (overrides: Partial<Offer> = {}): Offer =>
    ({
      id: OFFER_ID,
      hostId: USER_ID,
      propertyId: 'property-uuid-1',
      serviceType: 'standard',
      state: 'DRAFT',
      offeredPriceCents: 5000,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as Offer;

  const createMockExecutionContext = (
    params: { id?: string } = { id: OFFER_ID },
    userPayload: { keycloakId: string } = { keycloakId: KEYCLOAK_ID },
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          params,
          user: userPayload,
        }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OfferOwnerGuard,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: getRepositoryToken(Offer),
          useValue: mockOfferRepository,
        },
      ],
    }).compile();

    guard = module.get<OfferOwnerGuard>(OfferOwnerGuard);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('when user is the offer owner', () => {
    it('should allow access when the authenticated user owns the offer', async () => {
      mockUserRepository.findOne.mockResolvedValue(createMockUser());
      mockOfferRepository.findOne.mockResolvedValue(createMockOffer());

      const context = createMockExecutionContext();
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { keycloakId: KEYCLOAK_ID },
      });
      expect(mockOfferRepository.findOne).toHaveBeenCalledWith({
        where: {
          id: OFFER_ID,
          hostId: USER_ID,
        },
      });
    });
  });

  describe('when offer does not exist', () => {
    it('should throw ForbiddenException when offer ID does not match any record', async () => {
      mockUserRepository.findOne.mockResolvedValue(createMockUser());
      mockOfferRepository.findOne.mockResolvedValue(null);

      const context = createMockExecutionContext({ id: 'non-existent-uuid' });

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'You do not have permission to access this offer',
      );
    });
  });

  describe('when user is not the owner', () => {
    it('should throw ForbiddenException when offer belongs to another user', async () => {
      const anotherUserId = 'user-uuid-other';
      mockUserRepository.findOne.mockResolvedValue(
        createMockUser({ id: anotherUserId }),
      );
      mockOfferRepository.findOne.mockResolvedValue(null);

      const context = createMockExecutionContext();

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'You do not have permission to access this offer',
      );
    });
  });

  describe('when user is not found by keycloakId', () => {
    it('should throw ForbiddenException when no user matches the keycloakId', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      const context = createMockExecutionContext(
        { id: OFFER_ID },
        { keycloakId: 'unknown-keycloak-id' },
      );

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'You do not have permission to access this offer',
      );
      // Should NOT query offers if user lookup fails
      expect(mockOfferRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('error response validation', () => {
    it('should return HTTP 403 status code', async () => {
      mockUserRepository.findOne.mockResolvedValue(createMockUser());
      mockOfferRepository.findOne.mockResolvedValue(null);

      const context = createMockExecutionContext();

      try {
        await guard.canActivate(context);
        fail('Expected ForbiddenException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        expect((error as ForbiddenException).getStatus()).toBe(403);
      }
    });
  });

  describe('query correctness', () => {
    it('should query offer with both conditions: id and hostId', async () => {
      mockUserRepository.findOne.mockResolvedValue(createMockUser());
      mockOfferRepository.findOne.mockResolvedValue(createMockOffer());

      const context = createMockExecutionContext();
      await guard.canActivate(context);

      const offerQueryCall = mockOfferRepository.findOne.mock.calls[0][0];
      expect(offerQueryCall.where).toHaveProperty('id', OFFER_ID);
      expect(offerQueryCall.where).toHaveProperty('hostId', USER_ID);
    });
  });
});
