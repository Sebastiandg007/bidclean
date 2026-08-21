import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { KeycloakEmailEvent } from '../profile.types';

const EXPECTED_EVENT_TYPE = 'UPDATE_EMAIL';

/**
 * Keycloak email webhook service.
 * Processes email change events and updates the denormalized email cache.
 * Validates webhook secrets before processing.
 */
@Injectable()
export class KeycloakEmailService {
  private readonly logger = new Logger(KeycloakEmailService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /** Compare provided secret against configured KEYCLOAK_WEBHOOK_SECRET */
  validateWebhookSecret(secret: string): boolean {
    const expectedSecret = this.configService.get<string>('KEYCLOAK_WEBHOOK_SECRET');
    return secret === expectedSecret;
  }

  /**
   * Process a Keycloak email change event.
   * Updates the denormalized email column in users table by keycloak_id.
   * Ignores non-UPDATE_EMAIL events silently.
   * Logs warning if user not found (does not throw).
   */
  async processEmailChange(event: KeycloakEmailEvent): Promise<void> {
    if (event.type !== EXPECTED_EVENT_TYPE) {
      return;
    }

    const keycloakId = event.userId;
    const newEmail = event.details.updated_email;

    const result = await this.userRepository.update(
      { keycloakId },
      { email: newEmail },
    );

    if (result.affected === 0) {
      this.logger.warn(`No user found with keycloak_id=${keycloakId} for email update`);
      return;
    }

    this.logger.log(`Updated email for keycloak_id=${keycloakId}`);
  }
}
