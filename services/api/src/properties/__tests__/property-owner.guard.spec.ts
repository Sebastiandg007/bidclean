import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PropertyOwnerGuard } from '../guards/property-owner.guard';
import { Property } from '../entities/property.entity';
import { User } from '../../auth/entities/user.entity';

describe('PropertyOwnerGuard', () => {
  let guard: PropertyOwnerGuard;

  const mockUserRepository = {
    findOne: jest.fn(),
  };

  const mockPropertyRepository = {
    findOne: jest.fn(),
  };

  const KEYCLOAK_ID = 'kc-owner-123';
  const USER_ID = 'user-uuid-owner';
  const PROPERTY_ID = 'property-uuid-1';

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

  const createMockProperty = (overrides: Partial<Property> = {}): Property =>
    ({
      id: PROPERTY_ID,
      userId: USER_ID,
      name: 'My Apartment',
      type: 'apartment',
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as Property;

  const createMockExecutionContext = (
    params: { id?: string } = { id: PROPERTY_ID },
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
        PropertyOwnerGuard,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: getRepositoryToken(Property),
          useValue: mockPropertyRepository,
        },
      ],
    }).compile();

    guard = module.get<PropertyOwnerGuard>(PropertyOwnerGuard);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('when user is the property owner', () => {
    it('should allow access when the authenticated user owns the property', async () => {
      mockUserRepository.findOne.mockResolvedValue(createMockUser());
      mockPropertyRepository.findOne.mockResolvedValue(createMockProperty());

      const context = createMockExecutionContext();
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { keycloakId: KEYCLOAK_ID },
      });
      expect(mockPropertyRepository.findOne).toHaveBeenCalledWith({
        where: {
          id: PROPERTY_ID,
          userId: USER_ID,
          deletedAt: null,
        },
      });
    });
  });

  describe('when property does not exist', () => {
    it('should throw ForbiddenException when property ID does not match any record', async () => {
      mockUserRepository.findOne.mockResolvedValue(createMockUser());
      mockPropertyRepository.findOne.mockResolvedValue(null);

      const context = createMockExecutionContext({ id: 'non-existent-uuid' });

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'You do not have permission to access this property',
      );
    });
  });

  describe('when user is not the owner', () => {
    it('should throw ForbiddenException when property belongs to another user', async () => {
      const anotherUserId = 'user-uuid-other';
      mockUserRepository.findOne.mockResolvedValue(
        createMockUser({ id: anotherUserId }),
      );
      mockPropertyRepository.findOne.mockResolvedValue(null);

      const context = createMockExecutionContext();

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'You do not have permission to access this property',
      );
    });
  });

  describe('when property is soft-deleted', () => {
    it('should throw ForbiddenException when property has been soft-deleted', async () => {
      mockUserRepository.findOne.mockResolvedValue(createMockUser());
      // The query filters deletedAt: null, so a soft-deleted property won't be found
      mockPropertyRepository.findOne.mockResolvedValue(null);

      const context = createMockExecutionContext();

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'You do not have permission to access this property',
      );
    });
  });

  describe('when user is not found by keycloakId', () => {
    it('should throw ForbiddenException when no user matches the keycloakId', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      const context = createMockExecutionContext(
        { id: PROPERTY_ID },
        { keycloakId: 'unknown-keycloak-id' },
      );

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'You do not have permission to access this property',
      );
      // Should NOT query properties if user lookup fails
      expect(mockPropertyRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('error response validation', () => {
    it('should return HTTP 403 status code', async () => {
      mockUserRepository.findOne.mockResolvedValue(createMockUser());
      mockPropertyRepository.findOne.mockResolvedValue(null);

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
    it('should query property with all three conditions: id, userId, and deletedAt IS NULL', async () => {
      mockUserRepository.findOne.mockResolvedValue(createMockUser());
      mockPropertyRepository.findOne.mockResolvedValue(createMockProperty());

      const context = createMockExecutionContext();
      await guard.canActivate(context);

      const propertyQueryCall = mockPropertyRepository.findOne.mock.calls[0][0];
      expect(propertyQueryCall.where).toHaveProperty('id', PROPERTY_ID);
      expect(propertyQueryCall.where).toHaveProperty('userId', USER_ID);
      expect(propertyQueryCall.where).toHaveProperty('deletedAt', null);
    });
  });
});
