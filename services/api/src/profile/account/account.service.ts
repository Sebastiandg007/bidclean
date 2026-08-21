import {
  Injectable,
  BadRequestException,
  BadGatewayException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { KeycloakService } from '../../auth/keycloak/keycloak.service';
import { User } from '../../auth/entities/user.entity';
import { DeletionJobPayload } from '../profile.types';
import {
  EmailChangeUrlResponse,
  PasswordChangeUrlResponse,
} from './account.types';

/** Default Keycloak base URL for local development */
const DEFAULT_KEYCLOAK_BASE_URL = 'http://localhost:8080';

/** Default Keycloak realm name */
const DEFAULT_KEYCLOAK_REALM = 'bidclean';

/** Keycloak Account Console path for personal info (email change) */
const ACCOUNT_PERSONAL_INFO_PATH = 'account/#/personal-info';

/** Keycloak Account Console path for security/signin (password change) */
const ACCOUNT_SECURITY_SIGNIN_PATH = 'account/#/security/signingin';

/** Default confirmation word for account deletion */
const DEFAULT_CONFIRMATION_WORD = 'DELETE';

/** Default max retries for deletion job */
const DEFAULT_DELETION_MAX_RETRIES = '3';

/** Default backoff delay in ms for deletion job retries */
const DEFAULT_DELETION_BACKOFF_DELAY_MS = '5000';

/** BullMQ queue name for account deletion jobs */
const ACCOUNT_DELETION_QUEUE = 'account-deletion';

/**
 * Account service.
 * Handles email/password change URLs (Keycloak delegation)
 * and account deletion request flow.
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly configService: ConfigService,
    private readonly keycloakService: KeycloakService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectQueue(ACCOUNT_DELETION_QUEUE)
    private readonly deletionQueue: Queue,
  ) {}

  /**
   * Builds the Keycloak Account Console URL for email change.
   * The mobile app opens this in the system browser (not WebView).
   */
  async getEmailChangeUrl(
    _keycloakId: string,
  ): Promise<EmailChangeUrlResponse> {
    try {
      const baseUrl = this.configService.get<string>(
        'KEYCLOAK_BASE_URL',
        DEFAULT_KEYCLOAK_BASE_URL,
      );
      const realm = this.configService.get<string>(
        'KEYCLOAK_REALM',
        DEFAULT_KEYCLOAK_REALM,
      );

      const url = `${baseUrl}/realms/${realm}/${ACCOUNT_PERSONAL_INFO_PATH}`;

      return { url };
    } catch {
      throw new BadGatewayException('profile.error.email_change_failed');
    }
  }

  /**
   * Builds the Keycloak Account Console URL for password change.
   * The mobile app opens this in the system browser (not WebView).
   */
  async getPasswordChangeUrl(
    _keycloakId: string,
  ): Promise<PasswordChangeUrlResponse> {
    try {
      const baseUrl = this.configService.get<string>(
        'KEYCLOAK_BASE_URL',
        DEFAULT_KEYCLOAK_BASE_URL,
      );
      const realm = this.configService.get<string>(
        'KEYCLOAK_REALM',
        DEFAULT_KEYCLOAK_REALM,
      );

      const url = `${baseUrl}/realms/${realm}/${ACCOUNT_SECURITY_SIGNIN_PATH}`;

      return { url };
    } catch {
      throw new BadGatewayException('profile.error.password_change_failed');
    }
  }

  /**
   * Request account deletion.
   * Validates confirmation word, checks no active services, marks user
   * DELETION_PENDING, disables Keycloak account, and enqueues BullMQ job.
   */
  async requestAccountDeletion(
    userId: string,
    keycloakId: string,
    confirmationWord: string,
  ): Promise<void> {
    this.validateConfirmationWord(confirmationWord);
    await this.checkNoActiveServices(userId);
    await this.markDeletionPending(userId);
    await this.disableKeycloakAccount(keycloakId);
    await this.enqueueDeletionJob(userId, keycloakId);
  }

  /** Validates the confirmation word against the configured value. */
  private validateConfirmationWord(confirmationWord: string): void {
    const expected = this.configService.get<string>(
      'PROFILE_DELETE_CONFIRMATION_WORD',
      DEFAULT_CONFIRMATION_WORD,
    );

    if (confirmationWord !== expected) {
      throw new BadRequestException('profile.error.invalid_confirmation');
    }
  }

  /**
   * Checks that the user has no active services/offers in progress.
   * TODO(BID-service-history): Integrate with service-history module when implemented.
   * Currently checks deletion_status to prevent duplicate deletion requests.
   */
  private async checkNoActiveServices(userId: string): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (user?.deletionStatus === 'DELETION_PENDING') {
      throw new ConflictException('profile.error.active_services');
    }
  }

  /** Marks the user as DELETION_PENDING in the users table. */
  private async markDeletionPending(userId: string): Promise<void> {
    await this.userRepository.update(userId, {
      deletionStatus: 'DELETION_PENDING',
    });
  }

  /** Disables the user in Keycloak to prevent further login. */
  private async disableKeycloakAccount(keycloakId: string): Promise<void> {
    try {
      await this.keycloakService.disableUser(keycloakId);
    } catch {
      throw new BadGatewayException('profile.error.deletion_failed');
    }
  }

  /** Enqueues a BullMQ job for async account deletion cascade. */
  private async enqueueDeletionJob(
    userId: string,
    keycloakId: string,
  ): Promise<void> {
    const payload: DeletionJobPayload = {
      userId,
      keycloakId,
      idempotencyKey: randomUUID(),
      requestedAt: new Date(),
    };

    const maxRetries = Number(
      this.configService.get<string>(
        'PROFILE_DELETION_MAX_RETRIES',
        DEFAULT_DELETION_MAX_RETRIES,
      ),
    );
    const backoffDelay = Number(
      this.configService.get<string>(
        'PROFILE_DELETION_BACKOFF_DELAY_MS',
        DEFAULT_DELETION_BACKOFF_DELAY_MS,
      ),
    );

    await this.deletionQueue.add('delete-account', payload, {
      attempts: maxRetries,
      backoff: { type: 'exponential', delay: backoffDelay },
    });
  }
}
