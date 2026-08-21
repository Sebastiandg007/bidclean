import { Injectable, BadGatewayException, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

/**
 * Account service.
 * Handles email/password change URLs (Keycloak delegation)
 * and account deletion request flow.
 */
@Injectable()
export class AccountService {
  constructor(private readonly configService: ConfigService) {}

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

  async requestAccountDeletion(
    _userId: string,
    _confirmationWord: string,
  ): Promise<void> {
    throw new NotImplementedException();
  }
}
