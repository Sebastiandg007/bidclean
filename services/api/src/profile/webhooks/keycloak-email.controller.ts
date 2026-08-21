import { Controller, Post, Body, Headers, NotImplementedException } from '@nestjs/common';
import { KeycloakEmailService } from './keycloak-email.service';
import { KeycloakEmailEvent } from '../profile.types';

/**
 * Keycloak email webhook controller.
 * Receives email change events from Keycloak Event Listener.
 * Validates webhook secret before processing.
 */
@Controller('webhooks/keycloak')
export class KeycloakEmailController {
  constructor(private readonly keycloakEmailService: KeycloakEmailService) {}

  /** POST /webhooks/keycloak/email — receive email change event */
  @Post('email')
  async handleEmailEvent(
    @Body() _event: KeycloakEmailEvent,
    @Headers('x-webhook-secret') _webhookSecret: string,
  ): Promise<void> {
    void this.keycloakEmailService;
    throw new NotImplementedException();
  }
}
