import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { KeycloakEmailService } from '../webhooks/keycloak-email.service';

describe('KeycloakEmailService', () => {
  let service: KeycloakEmailService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KeycloakEmailService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<KeycloakEmailService>(KeycloakEmailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processEmailChange', () => {
    it.todo('should update denormalized email in users table');
    it.todo('should look up user by keycloak_id');
  });

  describe('validateWebhookSecret', () => {
    it.todo('should return true for valid secret');
    it.todo('should return false for invalid secret');
  });
});
