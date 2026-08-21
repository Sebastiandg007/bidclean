import { Controller, Post, Body, Headers, UnauthorizedException } from '@nestjs/common';
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
    @Body() event: KeycloakEmailEvent,
    @Headers('x-webhook-secret') webhookSecret: string,
  ): Promise<void> {
    if (!this.keycloakEmailService.validateWebhookSecret(webhookSecret)) {
      throw new UnauthorizedException();
    }

    await this.keycloakEmailService.processEmailChange(event);
  }
}
