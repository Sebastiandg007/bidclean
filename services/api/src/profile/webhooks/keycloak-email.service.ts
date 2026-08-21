import { Injectable, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KeycloakEmailEvent } from '../profile.types';

/**
 * Keycloak email webhook service.
 * Processes email change events and updates the denormalized email cache.
 * Validates webhook secrets before processing.
 */
@Injectable()
export class KeycloakEmailService {
  constructor(private readonly configService: ConfigService) {}

  async processEmailChange(_event: KeycloakEmailEvent): Promise<void> {
    throw new NotImplementedException();
  }

  validateWebhookSecret(secret: string): boolean {
    const expectedSecret = this.configService.get<string>('KEYCLOAK_WEBHOOK_SECRET');
    return secret === expectedSecret;
  }
}
