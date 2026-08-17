import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EmailVerificationSyncService } from '../keycloak/email-verification-sync.service';
import { User } from '../entities/user.entity';

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('EmailVerificationSyncService', () => {
  let service: EmailVerificationSyncService;
  let userRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };

  beforeEach(async () => {
    // Set env vars for Keycloak config
    process.env.KEYCLOAK_BASE_URL = 'http://localhost:8080';
    process.env.KEYCLOAK_REALM = 'bidclean';
    process.env.KEYCLOAK_ADMIN_USERNAME = 'admin';
    process.env.KEYCLOAK_ADMIN_PASSWORD = 'admin_local';

    userRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailVerificationSyncService,
        {
          provide: getRepositoryToken(User),
          useValue: userRepository,
        },
      ],
    }).compile();

    service = module.get<EmailVerificationSyncService>(
      EmailVerificationSyncService,
    );

    mockFetch.mockReset();
  });

  // -------------------------------------------------------------------------
  // Helper to mock admin token response
  // -------------------------------------------------------------------------

  function mockAdminToken(): void {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'mock-admin-token' }),
    });
  }

  function mockKeycloakUser(emailVerified: boolean): void {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'kc-user-1', email: 'test@example.com', emailVerified }),
    });
  }

  // -------------------------------------------------------------------------
  // syncUnverifiedUsers
  // -------------------------------------------------------------------------

  describe('syncUnverifiedUsers', () => {
    it('should do nothing when no unverified users exist', async () => {
      userRepository.find.mockResolvedValue([]);

      await service.syncUnverifiedUsers();

      expect(mockFetch).not.toHaveBeenCalled();
      expect(userRepository.update).not.toHaveBeenCalled();
    });

    it('should update user when Keycloak shows verified', async () => {
      const unverifiedUser = {
        id: 'user-1',
        keycloakId: 'kc-user-1',
        email: 'test@example.com',
      };
      userRepository.find.mockResolvedValue([unverifiedUser]);
      mockAdminToken();
      mockKeycloakUser(true);

      await service.syncUnverifiedUsers();

      expect(userRepository.update).toHaveBeenCalledWith('user-1', {
        isEmailVerified: true,
      });
    });

    it('should not update user when Keycloak still shows unverified', async () => {
      const unverifiedUser = {
        id: 'user-2',
        keycloakId: 'kc-user-2',
        email: 'unverified@example.com',
      };
      userRepository.find.mockResolvedValue([unverifiedUser]);
      mockAdminToken();
      mockKeycloakUser(false);

      await service.syncUnverifiedUsers();

      expect(userRepository.update).not.toHaveBeenCalled();
    });

    it('should handle Keycloak API errors gracefully', async () => {
      const unverifiedUser = {
        id: 'user-3',
        keycloakId: 'kc-user-3',
        email: 'error@example.com',
      };
      userRepository.find.mockResolvedValue([unverifiedUser]);
      mockAdminToken();
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      await service.syncUnverifiedUsers();

      expect(userRepository.update).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // checkAndUpdateVerification
  // -------------------------------------------------------------------------

  describe('checkAndUpdateVerification', () => {
    it('should return true when user is already verified', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 'user-1',
        keycloakId: 'kc-1',
        isEmailVerified: true,
      });

      const result = await service.checkAndUpdateVerification('user-1');

      expect(result).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return false when user does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      const result = await service.checkAndUpdateVerification('nonexistent');

      expect(result).toBe(false);
    });

    it('should check Keycloak and update when newly verified', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 'user-2',
        keycloakId: 'kc-2',
        isEmailVerified: false,
      });
      mockAdminToken();
      mockKeycloakUser(true);

      const result = await service.checkAndUpdateVerification('user-2');

      expect(result).toBe(true);
      expect(userRepository.update).toHaveBeenCalledWith('user-2', {
        isEmailVerified: true,
      });
    });

    it('should return false when Keycloak still shows unverified', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 'user-3',
        keycloakId: 'kc-3',
        isEmailVerified: false,
      });
      mockAdminToken();
      mockKeycloakUser(false);

      const result = await service.checkAndUpdateVerification('user-3');

      expect(result).toBe(false);
      expect(userRepository.update).not.toHaveBeenCalled();
    });

    it('should return false on Keycloak API error', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 'user-4',
        keycloakId: 'kc-4',
        isEmailVerified: false,
      });
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await service.checkAndUpdateVerification('user-4');

      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Static configuration
  // -------------------------------------------------------------------------

  describe('getSyncInterval', () => {
    it('should return default interval when env var is not set', () => {
      delete process.env.KEYCLOAK_EMAIL_SYNC_INTERVAL_MS;
      expect(EmailVerificationSyncService.getSyncInterval()).toBe(30_000);
    });

    it('should return configured interval from env var', () => {
      process.env.KEYCLOAK_EMAIL_SYNC_INTERVAL_MS = '60000';
      expect(EmailVerificationSyncService.getSyncInterval()).toBe(60_000);
    });

    it('should fallback to default on invalid env value', () => {
      process.env.KEYCLOAK_EMAIL_SYNC_INTERVAL_MS = 'not-a-number';
      expect(EmailVerificationSyncService.getSyncInterval()).toBe(30_000);
    });
  });
});
