import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Interval } from '@nestjs/schedule';
import { User } from '../entities/user.entity';
import { getKeycloakConfig, KeycloakConfig } from './keycloak.config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KeycloakUserRepresentation {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

interface KeycloakTokenResponse {
  readonly access_token: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SYNC_INTERVAL_MS = 30_000;
const DEFAULT_BATCH_SIZE = 50;

const ENDPOINT = {
  adminUser: (baseUrl: string, realm: string, userId: string) =>
    `${baseUrl}/admin/realms/${realm}/users/${userId}`,
  masterToken: (baseUrl: string) =>
    `${baseUrl}/realms/master/protocol/openid-connect/token`,
} as const;

/**
 * Periodically syncs email verification status from Keycloak to BidClean DB.
 *
 * Covers the gap where a user verifies their email (clicking the Keycloak link)
 * while already logged in — the BidClean database updates without waiting for
 * the next login callback.
 *
 * Also exposes an on-demand check for individual users (used by /auth/me).
 */
@Injectable()
export class EmailVerificationSyncService {
  private readonly logger = new Logger(EmailVerificationSyncService.name);
  private readonly config: KeycloakConfig;
  private readonly batchSize: number;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    this.config = getKeycloakConfig();
    this.batchSize = this.parseBatchSize();
  }

  // -------------------------------------------------------------------------
  // Scheduled sync
  // -------------------------------------------------------------------------

  /**
   * Runs at a configurable interval (default 30s).
   * Finds unverified users in BidClean DB, checks Keycloak for updates.
   */
  @Interval(EmailVerificationSyncService.getSyncInterval())
  async syncUnverifiedUsers(): Promise<void> {
    try {
      const unverifiedUsers = await this.userRepository.find({
        where: { isEmailVerified: false },
        take: this.batchSize,
        select: ['id', 'keycloakId', 'email'],
      });

      if (unverifiedUsers.length === 0) {
        return;
      }

      this.logger.debug(
        `Checking ${unverifiedUsers.length} unverified users against Keycloak`,
      );

      const adminToken = await this.getAdminAccessToken();
      let updatedCount = 0;

      for (const user of unverifiedUsers) {
        const verified = await this.checkKeycloakVerification(
          user.keycloakId,
          adminToken,
        );

        if (verified) {
          await this.userRepository.update(user.id, { isEmailVerified: true });
          updatedCount++;
          this.logger.log(
            `Email verified synced for user ${user.id} (${user.email})`,
          );
        }
      }

      if (updatedCount > 0) {
        this.logger.log(
          `Email verification sync complete: ${updatedCount}/${unverifiedUsers.length} users updated`,
        );
      }
    } catch (error) {
      this.logger.error(`Email verification sync failed: ${error}`);
    }
  }

  // -------------------------------------------------------------------------
  // On-demand check (used by /auth/me for unverified users)
  // -------------------------------------------------------------------------

  /**
   * Check and update a single user's email verification status from Keycloak.
   * Returns true if the user is now verified (or was already verified).
   */
  async checkAndUpdateVerification(userId: string): Promise<boolean> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'keycloakId', 'isEmailVerified'],
    });

    if (!user) {
      return false;
    }

    if (user.isEmailVerified) {
      return true;
    }

    try {
      const adminToken = await this.getAdminAccessToken();
      const verified = await this.checkKeycloakVerification(
        user.keycloakId,
        adminToken,
      );

      if (verified) {
        await this.userRepository.update(userId, { isEmailVerified: true });
        this.logger.log(
          `On-demand email verification synced for user ${userId}`,
        );
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(
        `On-demand verification check failed for user ${userId}: ${error}`,
      );
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Query Keycloak Admin API for a user's email verification status.
   */
  private async checkKeycloakVerification(
    keycloakUserId: string,
    adminToken: string,
  ): Promise<boolean> {
    const url = ENDPOINT.adminUser(
      this.config.baseUrl,
      this.config.realm,
      keycloakUserId,
    );

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok) {
      const errorBody = await this.safeReadBody(response);
      this.logger.warn(
        `Failed to fetch Keycloak user ${keycloakUserId}: ${response.status} - ${errorBody}`,
      );
      return false;
    }

    const userData = (await response.json()) as KeycloakUserRepresentation;
    return userData.emailVerified === true;
  }

  /**
   * Obtain an admin access token using resource owner password grant.
   */
  private async getAdminAccessToken(): Promise<string> {
    const url = ENDPOINT.masterToken(this.config.baseUrl);

    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: this.config.adminUsername,
      password: this.config.adminPassword,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorBody = await this.safeReadBody(response);
      throw new Error(
        `Failed to obtain Keycloak admin token: ${response.status} - ${errorBody}`,
      );
    }

    const data = (await response.json()) as KeycloakTokenResponse;
    return data.access_token;
  }

  /**
   * Safely read a response body as text (won't throw on empty body).
   */
  private async safeReadBody(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return '<unable to read response body>';
    }
  }

  /**
   * Parse batch size from environment with a safe default.
   */
  private parseBatchSize(): number {
    const envValue = process.env.KEYCLOAK_EMAIL_SYNC_BATCH_SIZE;
    const parsed = envValue ? parseInt(envValue, 10) : DEFAULT_BATCH_SIZE;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BATCH_SIZE;
  }

  /**
   * Get the sync interval from environment (static for decorator usage).
   */
  static getSyncInterval(): number {
    const envValue = process.env.KEYCLOAK_EMAIL_SYNC_INTERVAL_MS;
    const parsed = envValue ? parseInt(envValue, 10) : DEFAULT_SYNC_INTERVAL_MS;
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_SYNC_INTERVAL_MS;
  }
}
