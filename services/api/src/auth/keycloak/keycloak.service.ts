import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { getKeycloakConfig, KeycloakConfig } from './keycloak.config';
import { AuthTokens } from '../auth.types';

// ---------------------------------------------------------------------------
// Keycloak endpoint path templates
// ---------------------------------------------------------------------------

const ENDPOINT = {
  token: (baseUrl: string, realm: string) =>
    `${baseUrl}/realms/${realm}/protocol/openid-connect/token`,
  authorize: (baseUrl: string, realm: string) =>
    `${baseUrl}/realms/${realm}/protocol/openid-connect/auth`,
  userinfo: (baseUrl: string, realm: string) =>
    `${baseUrl}/realms/${realm}/protocol/openid-connect/userinfo`,
  adminUsers: (baseUrl: string, realm: string) =>
    `${baseUrl}/admin/realms/${realm}/users`,
  adminSession: (baseUrl: string, realm: string, sessionId: string) =>
    `${baseUrl}/admin/realms/${realm}/sessions/${sessionId}`,
} as const;

// ---------------------------------------------------------------------------
// Response types for internal use
// ---------------------------------------------------------------------------

interface KeycloakTokenResponse {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
  readonly token_type: string;
}

interface KeycloakUserInfo {
  readonly sub: string;
  readonly email: string;
  readonly email_verified: boolean;
  readonly name?: string;
  readonly preferred_username?: string;
}

interface PkceParams {
  readonly codeVerifier: string;
  readonly codeChallenge: string;
}

/**
 * Keycloak integration service.
 *
 * Handles all communication with Keycloak:
 * - User creation via Admin API
 * - Authorization URL generation (PKCE)
 * - Token exchange and refresh
 * - Session revocation
 * - User info retrieval
 */
@Injectable()
export class KeycloakService {
  private readonly logger = new Logger(KeycloakService.name);
  private readonly config: KeycloakConfig;

  constructor() {
    this.config = getKeycloakConfig();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Create a user in Keycloak realm via Admin API.
   * Sets email, full name, temporary password, and triggers verification email.
   */
  async createUser(
    email: string,
    password: string,
    fullName: string,
  ): Promise<string> {
    const adminToken = await this.getAdminAccessToken();

    const [firstName, ...lastNameParts] = fullName.split(' ');
    const lastName = lastNameParts.join(' ') || '';

    const userPayload = {
      email,
      username: email,
      firstName,
      lastName,
      enabled: true,
      emailVerified: false,
      credentials: [
        {
          type: 'password',
          value: password,
          temporary: false,
        },
      ],
      requiredActions: ['VERIFY_EMAIL'],
    };

    const url = ENDPOINT.adminUsers(this.config.baseUrl, this.config.realm);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(userPayload),
    });

    if (response.status === 409) {
      throw new HttpException(
        'A user with this email already exists',
        HttpStatus.CONFLICT,
      );
    }

    if (!response.ok) {
      const errorBody = await this.safeReadBody(response);
      this.logger.error(
        `Failed to create user in Keycloak: ${response.status} - ${errorBody}`,
      );
      throw new HttpException(
        'Failed to create user in identity provider',
        HttpStatus.BAD_GATEWAY,
      );
    }

    // Keycloak returns Location header with the new user URL
    const locationHeader = response.headers.get('location');
    const keycloakUserId = locationHeader
      ? locationHeader.split('/').pop() ?? ''
      : '';

    if (!keycloakUserId) {
      throw new HttpException(
        'Failed to retrieve created user ID from identity provider',
        HttpStatus.BAD_GATEWAY,
      );
    }

    // Trigger verification email
    await this.sendVerificationEmail(keycloakUserId, adminToken);

    this.logger.log(`User created in Keycloak: ${keycloakUserId}`);
    return keycloakUserId;
  }

  /**
   * Get the configured redirect URI for mobile OAuth flow.
   */
  getRedirectUri(): string {
    return this.config.redirectUri;
  }

  /**
   * Build Keycloak authorization URL with PKCE parameters.
   * Returns the URL and the code_verifier (client must store verifier for token exchange).
   */
  getAuthorizationUrl(
    redirectUri: string,
    state: string,
  ): { url: string; codeVerifier: string } {
    const { codeVerifier, codeChallenge } = this.generatePkceParams();

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const baseAuthUrl = ENDPOINT.authorize(
      this.config.baseUrl,
      this.config.realm,
    );

    return {
      url: `${baseAuthUrl}?${params.toString()}`,
      codeVerifier,
    };
  }

  /**
   * Exchange authorization code for tokens at Keycloak token endpoint.
   */
  async exchangeCodeForTokens(
    code: string,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<AuthTokens> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });

    return this.requestTokens(body);
  }

  /**
   * Refresh tokens via Keycloak token endpoint.
   */
  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: refreshToken,
    });

    return this.requestTokens(body);
  }

  /**
   * Revoke a specific session via Keycloak Admin API.
   */
  async revokeSession(keycloakSessionId: string): Promise<void> {
    const adminToken = await this.getAdminAccessToken();

    const url = ENDPOINT.adminSession(
      this.config.baseUrl,
      this.config.realm,
      keycloakSessionId,
    );

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok && response.status !== 404) {
      const errorBody = await this.safeReadBody(response);
      this.logger.error(
        `Failed to revoke session ${keycloakSessionId}: ${response.status} - ${errorBody}`,
      );
      throw new HttpException(
        'Failed to revoke session',
        HttpStatus.BAD_GATEWAY,
      );
    }

    this.logger.log(`Session revoked: ${keycloakSessionId}`);
  }

  /**
   * Revoke all sessions for a user via Keycloak Admin API.
   */
  async revokeAllSessions(keycloakUserId: string): Promise<void> {
    const adminToken = await this.getAdminAccessToken();

    const url = `${ENDPOINT.adminUsers(this.config.baseUrl, this.config.realm)}/${keycloakUserId}/logout`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok && response.status !== 404) {
      const errorBody = await this.safeReadBody(response);
      this.logger.error(
        `Failed to revoke all sessions for user ${keycloakUserId}: ${response.status} - ${errorBody}`,
      );
      throw new HttpException(
        'Failed to revoke all sessions',
        HttpStatus.BAD_GATEWAY,
      );
    }

    this.logger.log(`All sessions revoked for user: ${keycloakUserId}`);
  }

  /**
   * Get tokens on behalf of a user using Keycloak Token Exchange.
   *
   * Uses the service account (client credentials) to obtain a subject_token,
   * then exchanges it for user-scoped tokens via the
   * urn:ietf:params:oauth:grant-type:token-exchange grant.
   */
  async getTokensForUser(keycloakUserId: string): Promise<AuthTokens> {
    const serviceToken = await this.getServiceAccountToken();

    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      subject_token: serviceToken,
      requested_token_type: 'urn:ietf:params:oauth:token-type:refresh_token',
      requested_subject: keycloakUserId,
      scope: 'openid email profile',
    });

    return this.requestTokens(body);
  }

  /**
   * Fetch user info from Keycloak userinfo endpoint.
   */
  async getUserInfo(accessToken: string): Promise<KeycloakUserInfo> {
    const url = ENDPOINT.userinfo(this.config.baseUrl, this.config.realm);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.status === 401) {
      throw new UnauthorizedException('Access token is invalid or expired');
    }

    if (!response.ok) {
      const errorBody = await this.safeReadBody(response);
      this.logger.error(
        `Failed to fetch user info: ${response.status} - ${errorBody}`,
      );
      throw new HttpException(
        'Failed to retrieve user information',
        HttpStatus.BAD_GATEWAY,
      );
    }

    const data = (await response.json()) as KeycloakUserInfo;
    return data;
  }

  /**
   * Disable a user's Keycloak account (sets enabled: false).
   * Used during account deletion to immediately prevent login.
   */
  async disableUser(keycloakUserId: string): Promise<void> {
    const adminToken = await this.getAdminAccessToken();

    const url = `${ENDPOINT.adminUsers(this.config.baseUrl, this.config.realm)}/${keycloakUserId}`;

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ enabled: false }),
    });

    if (!response.ok) {
      const errorBody = await this.safeReadBody(response);
      this.logger.error(
        `Failed to disable user ${keycloakUserId}: ${response.status} - ${errorBody}`,
      );
      throw new HttpException(
        'Failed to disable user in identity provider',
        HttpStatus.BAD_GATEWAY,
      );
    }

    this.logger.log(`User disabled in Keycloak: ${keycloakUserId}`);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Obtain a service account token using client_credentials grant.
   * Used as the subject_token for Token Exchange impersonation.
   */
  private async getServiceAccountToken(): Promise<string> {
    const url = ENDPOINT.token(this.config.baseUrl, this.config.realm);

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorBody = await this.safeReadBody(response);
      this.logger.error(
        `Failed to obtain service account token: ${response.status} - ${errorBody}`,
      );
      throw new HttpException(
        'Failed to authenticate service account with identity provider',
        HttpStatus.BAD_GATEWAY,
      );
    }

    const data = (await response.json()) as KeycloakTokenResponse;
    return data.access_token;
  }

  /**
   * Obtain an admin access token using resource owner password grant.
   */
  private async getAdminAccessToken(): Promise<string> {
    const url = ENDPOINT.token(this.config.baseUrl, 'master');

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
      this.logger.error(
        `Failed to obtain admin token: ${response.status} - ${errorBody}`,
      );
      throw new HttpException(
        'Failed to authenticate with identity provider',
        HttpStatus.BAD_GATEWAY,
      );
    }

    const data = (await response.json()) as KeycloakTokenResponse;
    return data.access_token;
  }

  /**
   * Send verification email to a newly created user.
   */
  private async sendVerificationEmail(
    keycloakUserId: string,
    adminToken: string,
  ): Promise<void> {
    const url = `${ENDPOINT.adminUsers(this.config.baseUrl, this.config.realm)}/${keycloakUserId}/send-verify-email`;

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok) {
      // Non-critical: log but don't fail user creation
      this.logger.warn(
        `Failed to send verification email for user ${keycloakUserId}: ${response.status}`,
      );
    }
  }

  /**
   * Request tokens from Keycloak token endpoint.
   */
  private async requestTokens(body: URLSearchParams): Promise<AuthTokens> {
    const url = ENDPOINT.token(this.config.baseUrl, this.config.realm);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (response.status === 401 || response.status === 400) {
      const errorBody = await this.safeReadBody(response);
      this.logger.warn(`Token request rejected: ${response.status} - ${errorBody}`);
      throw new UnauthorizedException('Invalid or expired credentials');
    }

    if (!response.ok) {
      const errorBody = await this.safeReadBody(response);
      this.logger.error(
        `Token request failed: ${response.status} - ${errorBody}`,
      );
      throw new HttpException(
        'Failed to obtain tokens from identity provider',
        HttpStatus.BAD_GATEWAY,
      );
    }

    const data = (await response.json()) as KeycloakTokenResponse;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type,
    };
  }

  /**
   * Generate PKCE code_verifier and code_challenge (S256).
   */
  private generatePkceParams(): PkceParams {
    const codeVerifier = randomBytes(32)
      .toString('base64url')
      .replace(/[^a-zA-Z0-9\-._~]/g, '');

    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    return { codeVerifier, codeChallenge };
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
}
