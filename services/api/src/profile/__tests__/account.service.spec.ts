import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import {
  BadRequestException,
  BadGatewayException,
  ConflictException,
} from '@nestjs/common';
import { AccountService } from '../account/account.service';
import { KeycloakService } from '../../auth/keycloak/keycloak.service';
import { User } from '../../auth/entities/user.entity';

describe('AccountService', () => {
  let service: AccountService;
  let configService: { get: jest.Mock };
  let keycloakService: { disableUser: jest.Mock };
  let userRepository: { findOne: jest.Mock; update: jest.Mock };
  let deletionQueue: { add: jest.Mock };

  beforeEach(async () => {
    configService = {
      get: jest.fn((key: string, defaultValue?: string) => {
        if (key === 'PROFILE_DELETE_CONFIRMATION_WORD') return 'DELETE';
        if (key === 'PROFILE_DELETION_MAX_RETRIES') return '3';
        if (key === 'PROFILE_DELETION_BACKOFF_DELAY_MS') return '5000';
        return defaultValue;
      }),
    };

    keycloakService = {
      disableUser: jest.fn().mockResolvedValue(undefined),
    };

    userRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'user-1', deletionStatus: null }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    deletionQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        { provide: ConfigService, useValue: configService },
        { provide: KeycloakService, useValue: keycloakService },
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: getQueueToken('account-deletion'), useValue: deletionQueue },
      ],
    }).compile();

    service = module.get<AccountService>(AccountService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getEmailChangeUrl', () => {
    it('should return Keycloak email change URL with default config values', async () => {
      const result = await service.getEmailChangeUrl('user-123');

      expect(result).toEqual({
        url: 'http://localhost:8080/realms/bidclean/account/#/personal-info',
      });
    });

    it('should construct URL using configured base URL and realm', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'KEYCLOAK_BASE_URL') return 'https://auth.bidclean.tech';
        if (key === 'KEYCLOAK_REALM') return 'production';
        return undefined;
      });

      const result = await service.getEmailChangeUrl('user-456');

      expect(result.url).toBe(
        'https://auth.bidclean.tech/realms/production/account/#/personal-info',
      );
    });

    it('should contain the correct realm in the URL', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'KEYCLOAK_BASE_URL') return 'http://localhost:8080';
        if (key === 'KEYCLOAK_REALM') return 'my-realm';
        return undefined;
      });

      const result = await service.getEmailChangeUrl('any-user');

      expect(result.url).toContain('/realms/my-realm/');
    });

    it('should end with account personal info path', async () => {
      const result = await service.getEmailChangeUrl('any-user');

      expect(result.url).toContain('account/#/personal-info');
    });

    it('should read KEYCLOAK_BASE_URL from config service', async () => {
      await service.getEmailChangeUrl('user-id');

      expect(configService.get).toHaveBeenCalledWith(
        'KEYCLOAK_BASE_URL',
        'http://localhost:8080',
      );
    });

    it('should read KEYCLOAK_REALM from config service', async () => {
      await service.getEmailChangeUrl('user-id');

      expect(configService.get).toHaveBeenCalledWith(
        'KEYCLOAK_REALM',
        'bidclean',
      );
    });
  });

  describe('getPasswordChangeUrl', () => {
    it('should return Keycloak password change URL with default config values', async () => {
      const result = await service.getPasswordChangeUrl('user-123');

      expect(result).toEqual({
        url: 'http://localhost:8080/realms/bidclean/account/#/security/signingin',
      });
    });

    it('should construct URL using configured base URL and realm', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'KEYCLOAK_BASE_URL') return 'https://auth.bidclean.tech';
        if (key === 'KEYCLOAK_REALM') return 'production';
        return undefined;
      });

      const result = await service.getPasswordChangeUrl('user-456');

      expect(result.url).toBe(
        'https://auth.bidclean.tech/realms/production/account/#/security/signingin',
      );
    });

    it('should contain the correct realm in the URL', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'KEYCLOAK_BASE_URL') return 'http://localhost:8080';
        if (key === 'KEYCLOAK_REALM') return 'my-realm';
        return undefined;
      });

      const result = await service.getPasswordChangeUrl('any-user');

      expect(result.url).toContain('/realms/my-realm/');
    });

    it('should end with account security signin path', async () => {
      const result = await service.getPasswordChangeUrl('any-user');

      expect(result.url).toContain('account/#/security/signingin');
    });

    it('should read KEYCLOAK_BASE_URL from config service', async () => {
      await service.getPasswordChangeUrl('user-id');

      expect(configService.get).toHaveBeenCalledWith(
        'KEYCLOAK_BASE_URL',
        'http://localhost:8080',
      );
    });

    it('should read KEYCLOAK_REALM from config service', async () => {
      await service.getPasswordChangeUrl('user-id');

      expect(configService.get).toHaveBeenCalledWith(
        'KEYCLOAK_REALM',
        'bidclean',
      );
    });
  });

  describe('requestAccountDeletion', () => {
    const userId = 'user-1';
    const keycloakId = 'kc-user-1';
    const confirmationWord = 'DELETE';

    it('should validate confirmation word and throw BadRequestException on mismatch', async () => {
      await expect(
        service.requestAccountDeletion(userId, keycloakId, 'WRONG'),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.requestAccountDeletion(userId, keycloakId, 'WRONG'),
      ).rejects.toThrow('profile.error.invalid_confirmation');
    });

    it('should reject when user already has DELETION_PENDING status', async () => {
      userRepository.findOne.mockResolvedValue({
        id: userId,
        deletionStatus: 'DELETION_PENDING',
      });

      await expect(
        service.requestAccountDeletion(userId, keycloakId, confirmationWord),
      ).rejects.toThrow(ConflictException);

      await expect(
        service.requestAccountDeletion(userId, keycloakId, confirmationWord),
      ).rejects.toThrow('profile.error.active_services');
    });

    it('should mark user as DELETION_PENDING', async () => {
      await service.requestAccountDeletion(userId, keycloakId, confirmationWord);

      expect(userRepository.update).toHaveBeenCalledWith(userId, {
        deletionStatus: 'DELETION_PENDING',
      });
    });

    it('should disable Keycloak account', async () => {
      await service.requestAccountDeletion(userId, keycloakId, confirmationWord);

      expect(keycloakService.disableUser).toHaveBeenCalledWith(keycloakId);
    });

    it('should throw BadGatewayException when Keycloak disable fails', async () => {
      keycloakService.disableUser.mockRejectedValue(new Error('Keycloak error'));

      await expect(
        service.requestAccountDeletion(userId, keycloakId, confirmationWord),
      ).rejects.toThrow(BadGatewayException);

      await expect(
        service.requestAccountDeletion(userId, keycloakId, confirmationWord),
      ).rejects.toThrow('profile.error.deletion_failed');
    });

    it('should enqueue BullMQ deletion job with correct payload', async () => {
      await service.requestAccountDeletion(userId, keycloakId, confirmationWord);

      expect(deletionQueue.add).toHaveBeenCalledWith(
        'delete-account',
        expect.objectContaining({
          userId,
          keycloakId,
          idempotencyKey: expect.any(String),
          requestedAt: expect.any(Date),
        }),
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        }),
      );
    });

    it('should complete successfully on valid deletion request', async () => {
      await expect(
        service.requestAccountDeletion(userId, keycloakId, confirmationWord),
      ).resolves.toBeUndefined();

      expect(userRepository.update).toHaveBeenCalled();
      expect(keycloakService.disableUser).toHaveBeenCalled();
      expect(deletionQueue.add).toHaveBeenCalled();
    });
  });
});
