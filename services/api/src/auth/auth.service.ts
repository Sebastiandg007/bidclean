import { Injectable, Logger, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { KeycloakService } from './keycloak/keycloak.service';
import { EmailVerificationSyncService } from './keycloak/email-verification-sync.service';
import { SessionService } from './session/session.service';
import { BiometricService } from './biometric/biometric.service';
import { RegisterDto } from './dto/register.dto';
import { RegisterBiometricDto } from './dto/register-biometric.dto';
import { BiometricVerifyDto } from './dto/biometric-verify.dto';
import { User } from './entities/user.entity';
import {
  AuthTokens,
  BiometricChallenge,
  CallbackResult,
  HandleCallbackOptions,
  LoginUrlResponse,
  LogoutResponse,
  RegistrationResult,
  UserProfileResponse,
} from './auth.types';

/**
 * Core authentication service.
 *
 * Orchestrates registration, login, session management,
 * and biometric flows by coordinating with Keycloak,
 * session, and biometric services.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly keycloakService: KeycloakService,
    private readonly emailVerificationSyncService: EmailVerificationSyncService,
    private readonly sessionService: SessionService,
    private readonly biometricService: BiometricService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async register(registerDto: RegisterDto): Promise<RegistrationResult> {
    const { email, password, fullName, country, language } = registerDto;

    const keycloakUserId = await this.keycloakService.createUser(
      email,
      password,
      fullName,
    );

    try {
      const user = this.userRepository.create({
        keycloakId: keycloakUserId,
        email,
        fullName,
        country,
        language,
        isEmailVerified: false,
      });

      const savedUser = await this.userRepository.save(user);

      return {
        userId: savedUser.id,
        email: savedUser.email,
        message:
          'Registration successful. Please check your email for verification.',
      };
    } catch (error) {
      this.logger.error(
        `Failed to save user in database after Keycloak creation: ${error}`,
      );
      throw new HttpException(
        'Registration failed. Please try again.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  getKeycloakLoginUrl(redirectUri?: string): LoginUrlResponse {
    const finalRedirectUri =
      redirectUri || this.keycloakService.getRedirectUri();
    const state = this.generateState();

    const { url, codeVerifier } =
      this.keycloakService.getAuthorizationUrl(finalRedirectUri, state);

    return { url, codeVerifier, state };
  }

  private generateState(): string {
    return randomBytes(32).toString('base64url');
  }

  async handleKeycloakCallback(options: HandleCallbackOptions): Promise<CallbackResult> {
    const { code, redirectUri, codeVerifier, deviceId, ipAddress, userAgent } = options;

    // 1. Exchange authorization code for tokens via Keycloak
    const tokens = await this.keycloakService.exchangeCodeForTokens(code, redirectUri, codeVerifier);

    // 2. Get user info from Keycloak
    const userInfo = await this.keycloakService.getUserInfo(tokens.accessToken);

    // 3. Find or create BidClean user
    const user = await this.findOrCreateUser(userInfo);

    // 4. Extract Keycloak session ID from access token
    const keycloakSessionId = this.extractSessionIdFromToken(tokens.accessToken);

    // 5. Create auth_session metadata
    const session = await this.sessionService.createSession(
      user.id,
      keycloakSessionId,
      deviceId,
      ipAddress,
      userAgent,
    );

    this.logger.log(`Callback processed for user ${user.id} (session: ${session.id})`);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      tokenType: tokens.tokenType,
      sessionId: session.id,
      userId: user.id,
    };
  }

  private async findOrCreateUser(userInfo: {
    sub: string;
    email: string;
    email_verified: boolean;
    name?: string;
    preferred_username?: string;
  }): Promise<User> {
    const existingUser = await this.userRepository.findOne({
      where: { keycloakId: userInfo.sub },
    });

    if (existingUser) {
      // Update email verification status if changed
      if (existingUser.isEmailVerified !== userInfo.email_verified) {
        existingUser.isEmailVerified = userInfo.email_verified;
        await this.userRepository.save(existingUser);
        this.logger.log(`Updated email verification for user ${existingUser.id}`);
      }
      return existingUser;
    }

    // Create new user from Keycloak info
    const newUser = this.userRepository.create({
      keycloakId: userInfo.sub,
      email: userInfo.email,
      fullName: userInfo.name || userInfo.preferred_username || userInfo.email,
      country: process.env.DEFAULT_USER_COUNTRY || 'US',
      language: process.env.DEFAULT_USER_LANGUAGE || 'en',
      isEmailVerified: userInfo.email_verified,
    });

    const savedUser = await this.userRepository.save(newUser);
    this.logger.log(`New user created from Keycloak login: ${savedUser.id}`);

    return savedUser;
  }

  /**
   * Extract the Keycloak session ID (session_state or sid) from a JWT access token.
   * We decode without verification since we just received it from Keycloak.
   */
  private extractSessionIdFromToken(accessToken: string): string {
    try {
      const payloadSegment = accessToken.split('.')[1];
      if (!payloadSegment) {
        return '';
      }

      const payload = JSON.parse(
        Buffer.from(payloadSegment, 'base64url').toString('utf-8'),
      );

      return payload.session_state || payload.sid || '';
    } catch {
      this.logger.warn('Failed to extract session ID from access token');
      return '';
    }
  }

  async refreshToken(refreshToken: string): Promise<AuthTokens> {
    return this.keycloakService.refreshTokens(refreshToken);
  }

  /**
   * Revokes the Keycloak session and removes the corresponding
   * local auth_session metadata. Keycloak revocation always runs
   * even if local metadata is missing (edge case: session expired
   * before the user explicitly logged out).
   */
  async logout(keycloakSessionId?: string): Promise<LogoutResponse> {
    if (!keycloakSessionId) {
      this.logger.warn('Logout attempted without a session state in the token');
      return { message: 'Logged out successfully' };
    }

    await this.keycloakService.revokeSession(keycloakSessionId);

    const localSession = await this.sessionService.findSessionByKeycloakSessionId(keycloakSessionId);

    if (localSession) {
      await this.sessionService.removeSession(localSession.id);
      this.logger.log(`Logout complete: Keycloak session ${keycloakSessionId}, local session ${localSession.id}`);
    } else {
      this.logger.warn(`Logout: no local session found for Keycloak session ${keycloakSessionId} (already cleaned up)`);
    }

    return { message: 'Logged out successfully' };
  }

  async logoutAll(userId: string): Promise<LogoutResponse> {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    await this.keycloakService.revokeAllSessions(user.keycloakId);
    await this.sessionService.removeAllSessionsForUser(userId);

    this.logger.log(`All sessions revoked for user ${userId}`);

    return { message: 'All sessions revoked successfully' };
  }

  async registerBiometric(dto: RegisterBiometricDto): Promise<void> {
    return this.biometricService.registerCredential(dto);
  }

  async generateBiometricChallenge(deviceId: string): Promise<BiometricChallenge> {
    return this.biometricService.generateChallenge(deviceId);
  }

  async verifyBiometric(biometricVerifyDto: BiometricVerifyDto): Promise<AuthTokens> {
    return this.biometricService.verifyChallenge(biometricVerifyDto);
  }

  async getCurrentUser(keycloakId: string): Promise<UserProfileResponse> {
    const user = await this.userRepository.findOne({
      where: { keycloakId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // On-demand email verification sync for unverified users
    if (!user.isEmailVerified) {
      const nowVerified =
        await this.emailVerificationSyncService.checkAndUpdateVerification(user.id);
      if (nowVerified) {
        user.isEmailVerified = true;
      }
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      country: user.country,
      language: user.language,
      isEmailVerified: user.isEmailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
