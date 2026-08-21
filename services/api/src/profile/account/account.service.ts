import { Injectable, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Account service.
 * Handles email/password change URLs (Keycloak delegation)
 * and account deletion request flow.
 */
@Injectable()
export class AccountService {
  constructor(private readonly configService: ConfigService) {}

  async getEmailChangeUrl(_userId: string): Promise<{ url: string }> {
    void this.configService;
    throw new NotImplementedException();
  }

  async getPasswordChangeUrl(_userId: string): Promise<{ url: string }> {
    throw new NotImplementedException();
  }

  async requestAccountDeletion(
    _userId: string,
    _confirmationWord: string,
  ): Promise<void> {
    throw new NotImplementedException();
  }
}
