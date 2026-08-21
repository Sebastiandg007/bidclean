import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AccountService } from '../account/account.service';

describe('AccountService', () => {
  let service: AccountService;
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    configService = {
      get: jest.fn((_key: string, defaultValue: string) => defaultValue),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<AccountService>(AccountService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getEmailChangeUrl', () => {
    it('should return Keycloak email change URL with default config values', async () => {
      // Arrange
      const keycloakId = 'user-123';

      // Act
      const result = await service.getEmailChangeUrl(keycloakId);

      // Assert
      expect(result).toEqual({
        url: 'http://localhost:8080/realms/bidclean/account/#/personal-info',
      });
    });

    it('should construct URL using configured base URL and realm', async () => {
      // Arrange
      configService.get.mockImplementation((key: string) => {
        if (key === 'KEYCLOAK_BASE_URL') return 'https://auth.bidclean.tech';
        if (key === 'KEYCLOAK_REALM') return 'production';
        return undefined;
      });
      const keycloakId = 'user-456';

      // Act
      const result = await service.getEmailChangeUrl(keycloakId);

      // Assert
      expect(result.url).toBe(
        'https://auth.bidclean.tech/realms/production/account/#/personal-info',
      );
    });

    it('should contain the correct realm in the URL', async () => {
      // Arrange
      configService.get.mockImplementation((key: string) => {
        if (key === 'KEYCLOAK_BASE_URL') return 'http://localhost:8080';
        if (key === 'KEYCLOAK_REALM') return 'my-realm';
        return undefined;
      });

      // Act
      const result = await service.getEmailChangeUrl('any-user');

      // Assert
      expect(result.url).toContain('/realms/my-realm/');
    });

    it('should end with account personal info path', async () => {
      // Act
      const result = await service.getEmailChangeUrl('any-user');

      // Assert
      expect(result.url).toContain('account/#/personal-info');
    });

    it('should read KEYCLOAK_BASE_URL from config service', async () => {
      // Act
      await service.getEmailChangeUrl('user-id');

      // Assert
      expect(configService.get).toHaveBeenCalledWith(
        'KEYCLOAK_BASE_URL',
        'http://localhost:8080',
      );
    });

    it('should read KEYCLOAK_REALM from config service', async () => {
      // Act
      await service.getEmailChangeUrl('user-id');

      // Assert
      expect(configService.get).toHaveBeenCalledWith(
        'KEYCLOAK_REALM',
        'bidclean',
      );
    });
  });

  describe('getPasswordChangeUrl', () => {
    it.todo('should return Keycloak password change URL');
  });

  describe('requestAccountDeletion', () => {
    it.todo('should validate confirmation word');
    it.todo('should reject when active services exist');
    it.todo('should mark user as DELETION_PENDING');
    it.todo('should enqueue BullMQ deletion job');
  });
});
