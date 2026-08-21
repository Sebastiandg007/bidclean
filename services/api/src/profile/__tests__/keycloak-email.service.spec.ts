import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnauthorizedException } from '@nestjs/common';
import { KeycloakEmailService } from '../webhooks/keycloak-email.service';
import { KeycloakEmailController } from '../webhooks/keycloak-email.controller';
import { User } from '../../auth/entities/user.entity';
import { KeycloakEmailEvent } from '../profile.types';

describe('KeycloakEmailService', () => {
  let service: KeycloakEmailService;
  let mockUserRepository: { update: jest.Mock };
  let mockConfigService: { get: jest.Mock };

  const WEBHOOK_SECRET = 'test-webhook-secret-123';

  beforeEach(async () => {
    mockUserRepository = {
      update: jest.fn(),
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue(WEBHOOK_SECRET),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KeycloakEmailService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: getRepositoryToken(User), useValue: mockUserRepository },
      ],
    }).compile();

    service = module.get<KeycloakEmailService>(KeycloakEmailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateWebhookSecret', () => {
    it('should return true for valid secret', () => {
      const result = service.validateWebhookSecret(WEBHOOK_SECRET);
      expect(result).toBe(true);
    });

    it('should return false for invalid secret', () => {
      const result = service.validateWebhookSecret('wrong-secret');
      expect(result).toBe(false);
    });

    it('should return false for empty secret', () => {
      const result = service.validateWebhookSecret('');
      expect(result).toBe(false);
    });
  });

  describe('processEmailChange', () => {
    const validEvent: KeycloakEmailEvent = {
      userId: 'keycloak-user-id-123',
      type: 'UPDATE_EMAIL',
      details: { updated_email: 'new@example.com' },
    };

    it('should update email in users table by keycloak_id', async () => {
      mockUserRepository.update.mockResolvedValue({ affected: 1 });

      await service.processEmailChange(validEvent);

      expect(mockUserRepository.update).toHaveBeenCalledWith(
        { keycloakId: 'keycloak-user-id-123' },
        { email: 'new@example.com' },
      );
    });

    it('should ignore non-UPDATE_EMAIL event types', async () => {
      const otherEvent: KeycloakEmailEvent = {
        userId: 'keycloak-user-id-123',
        type: 'DELETE_ACCOUNT',
        details: { updated_email: 'new@example.com' },
      };

      await service.processEmailChange(otherEvent);

      expect(mockUserRepository.update).not.toHaveBeenCalled();
    });

    it('should log warning if user not found and not throw', async () => {
      mockUserRepository.update.mockResolvedValue({ affected: 0 });

      const loggerWarnSpy = jest.spyOn(service['logger'], 'warn');

      await expect(service.processEmailChange(validEvent)).resolves.toBeUndefined();

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('No user found with keycloak_id=keycloak-user-id-123'),
      );
    });

    it('should log success when email is updated', async () => {
      mockUserRepository.update.mockResolvedValue({ affected: 1 });

      const loggerLogSpy = jest.spyOn(service['logger'], 'log');

      await service.processEmailChange(validEvent);

      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Updated email for keycloak_id=keycloak-user-id-123'),
      );
    });
  });
});

describe('KeycloakEmailController', () => {
  let controller: KeycloakEmailController;
  let mockService: {
    validateWebhookSecret: jest.Mock;
    processEmailChange: jest.Mock;
  };

  beforeEach(async () => {
    mockService = {
      validateWebhookSecret: jest.fn(),
      processEmailChange: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [KeycloakEmailController],
      providers: [
        { provide: KeycloakEmailService, useValue: mockService },
      ],
    }).compile();

    controller = module.get<KeycloakEmailController>(KeycloakEmailController);
  });

  it('should throw UnauthorizedException when webhook secret is invalid', async () => {
    mockService.validateWebhookSecret.mockReturnValue(false);

    const event: KeycloakEmailEvent = {
      userId: 'keycloak-user-id-123',
      type: 'UPDATE_EMAIL',
      details: { updated_email: 'new@example.com' },
    };

    await expect(
      controller.handleEmailEvent(event, 'bad-secret'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should process event when webhook secret is valid', async () => {
    mockService.validateWebhookSecret.mockReturnValue(true);

    const event: KeycloakEmailEvent = {
      userId: 'keycloak-user-id-123',
      type: 'UPDATE_EMAIL',
      details: { updated_email: 'new@example.com' },
    };

    await controller.handleEmailEvent(event, 'valid-secret');

    expect(mockService.processEmailChange).toHaveBeenCalledWith(event);
  });

  it('should return void on successful processing', async () => {
    mockService.validateWebhookSecret.mockReturnValue(true);

    const event: KeycloakEmailEvent = {
      userId: 'keycloak-user-id-123',
      type: 'UPDATE_EMAIL',
      details: { updated_email: 'new@example.com' },
    };

    const result = await controller.handleEmailEvent(event, 'valid-secret');
    expect(result).toBeUndefined();
  });
});
