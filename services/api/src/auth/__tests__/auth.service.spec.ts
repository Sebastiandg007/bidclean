import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AuthService } from '../auth.service';
import { KeycloakService } from '../keycloak/keycloak.service';
import { EmailVerificationSyncService } from '../keycloak/email-verification-sync.service';
import { SessionService } from '../session/session.service';
import { BiometricService } from '../biometric/biometric.service';
import { User } from '../entities/user.entity';
import { RegisterDto } from '../dto/register.dto';

type MockKeycloakService = jest.Mocked<Pick<
  KeycloakService,
  'createUser' | 'getAuthorizationUrl' | 'getRedirectUri' |
  'exchangeCodeForTokens' | 'getUserInfo' | 'revokeSession' | 'revokeAllSessions'
>>;

type MockSessionService = jest.Mocked<Pick<
  SessionService,
  'createSession' | 'findSessionByKeycloakSessionId' | 'removeSession' | 'removeAllSessionsForUser'
>>;

type MockUserRepository = jest.Mocked<Pick<Repository<User>, 'findOne' | 'create' | 'save'>>;

describe('AuthService', () => {
  let authService: AuthService;
  let keycloakService: MockKeycloakService;
  let sessionService: MockSessionService;
  let userRepository: MockUserRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: KeycloakService,
          useValue: {
            createUser: jest.fn(),
            getAuthorizationUrl: jest.fn(),
            getRedirectUri: jest.fn(),
            exchangeCodeForTokens: jest.fn(),
            getUserInfo: jest.fn(),
            revokeSession: jest.fn(),
            revokeAllSessions: jest.fn(),
          },
        },
        {
          provide: EmailVerificationSyncService,
          useValue: {
            checkAndUpdateVerification: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: SessionService,
          useValue: {
            createSession: jest.fn(),
            findSessionByKeycloakSessionId: jest.fn(),
            removeSession: jest.fn().mockResolvedValue(undefined),
            removeAllSessionsForUser: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: BiometricService,
          useValue: {
            registerCredential: jest.fn(),
            generateChallenge: jest.fn(),
            verifyChallenge: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn((entity) => entity),
            save: jest.fn(),
          },
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    keycloakService = module.get(KeycloakService);
    sessionService = module.get(SessionService);
    userRepository = module.get(getRepositoryToken(User));
  });

  // ---------------------------------------------------------------------------
  // Register Flow
  // ---------------------------------------------------------------------------

  describe('register', () => {
    const registerDto: RegisterDto = {
      fullName: 'Maria Lopez',
      email: 'maria@example.com',
      password: 'Str0ng!Pass',
      country: 'CO',
      language: 'es',
    };

    it('should register a new user successfully', async () => {
      const keycloakUserId = 'kc-uuid-001';
      const savedUser = {
        id: 'bidclean-uuid-001',
        keycloakId: keycloakUserId,
        email: registerDto.email,
        fullName: registerDto.fullName,
        country: registerDto.country,
        language: registerDto.language,
        isEmailVerified: false,
      };

      keycloakService.createUser.mockResolvedValue(keycloakUserId);
      userRepository.save.mockResolvedValue(savedUser as any);

      const result = await authService.register(registerDto);

      expect(keycloakService.createUser).toHaveBeenCalledWith(
        registerDto.email,
        registerDto.password,
        registerDto.fullName,
      );
      expect(userRepository.create).toHaveBeenCalledWith({
        keycloakId: keycloakUserId,
        email: registerDto.email,
        fullName: registerDto.fullName,
        country: registerDto.country,
        language: registerDto.language,
        isEmailVerified: false,
      });
      expect(userRepository.save).toHaveBeenCalled();
      expect(result).toEqual({
        userId: savedUser.id,
        email: savedUser.email,
        message: 'Registration successful. Please check your email for verification.',
      });
    });

    it('should throw HttpException (409 Conflict) when email already exists in Keycloak', async () => {
      keycloakService.createUser.mockRejectedValue(
        new HttpException('A user with this email already exists', HttpStatus.CONFLICT),
      );

      await expect(authService.register(registerDto)).rejects.toThrow(HttpException);
      await expect(authService.register(registerDto)).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
      });
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('should throw HttpException (500) when database save fails after Keycloak creation', async () => {
      keycloakService.createUser.mockResolvedValue('kc-uuid-002');
      userRepository.save.mockRejectedValue(new Error('DB connection lost'));

      await expect(authService.register(registerDto)).rejects.toThrow(HttpException);
      await expect(authService.register(registerDto)).rejects.toMatchObject({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // handleKeycloakCallback Flow
  // ---------------------------------------------------------------------------

  describe('handleKeycloakCallback', () => {
    const callbackOptions = {
      code: 'auth-code-xyz',
      redirectUri: 'bidclean://callback',
      codeVerifier: 'verifier-abc',
      deviceId: 'device-iphone-14',
      ipAddress: '192.168.1.100',
      userAgent: 'BidClean/1.0 iOS',
    };

    const mockTokens = {
      accessToken: buildMockJwt({ session_state: 'kc-session-789', sub: 'kc-sub-001' }),
      refreshToken: 'refresh-token-abc',
      expiresIn: 3600,
      tokenType: 'Bearer',
    };

    const mockUserInfo = {
      sub: 'kc-sub-001',
      email: 'maria@example.com',
      email_verified: true,
      name: 'Maria Lopez',
      preferred_username: 'maria@example.com',
    };

    it('should exchange authorization code for tokens and create session', async () => {
      const existingUser = {
        id: 'bidclean-uuid-001',
        keycloakId: 'kc-sub-001',
        email: 'maria@example.com',
        fullName: 'Maria Lopez',
        isEmailVerified: true,
      };

      const createdSession = {
        id: 'session-uuid-001',
        userId: existingUser.id,
        keycloakSessionId: 'kc-session-789',
        deviceId: callbackOptions.deviceId,
      };

      keycloakService.exchangeCodeForTokens.mockResolvedValue(mockTokens);
      keycloakService.getUserInfo.mockResolvedValue(mockUserInfo);
      userRepository.findOne.mockResolvedValue(existingUser as any);
      sessionService.createSession.mockResolvedValue(createdSession as any);

      const result = await authService.handleKeycloakCallback(callbackOptions);

      expect(keycloakService.exchangeCodeForTokens).toHaveBeenCalledWith(
        callbackOptions.code,
        callbackOptions.redirectUri,
        callbackOptions.codeVerifier,
      );
      expect(keycloakService.getUserInfo).toHaveBeenCalledWith(mockTokens.accessToken);
      expect(result).toEqual({
        accessToken: mockTokens.accessToken,
        refreshToken: mockTokens.refreshToken,
        expiresIn: mockTokens.expiresIn,
        tokenType: mockTokens.tokenType,
        sessionId: createdSession.id,
        userId: existingUser.id,
      });
    });

    it('should create a new user when Keycloak user does not exist in BidClean DB', async () => {
      const newUserInfo = {
        sub: 'kc-sub-new-999',
        email: 'nuevo@example.com',
        email_verified: false,
        name: 'Carlos Nuevo',
      };

      const savedNewUser = {
        id: 'bidclean-uuid-new',
        keycloakId: newUserInfo.sub,
        email: newUserInfo.email,
        fullName: newUserInfo.name,
        country: 'US',
        language: 'en',
        isEmailVerified: false,
      };

      const createdSession = { id: 'session-uuid-new' };

      keycloakService.exchangeCodeForTokens.mockResolvedValue(mockTokens);
      keycloakService.getUserInfo.mockResolvedValue(newUserInfo as any);
      userRepository.findOne.mockResolvedValue(null);
      userRepository.save.mockResolvedValue(savedNewUser as any);
      sessionService.createSession.mockResolvedValue(createdSession as any);

      const result = await authService.handleKeycloakCallback(callbackOptions);

      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { keycloakId: newUserInfo.sub },
      });
      expect(userRepository.create).toHaveBeenCalledWith({
        keycloakId: newUserInfo.sub,
        email: newUserInfo.email,
        fullName: newUserInfo.name,
        country: 'US',
        language: 'en',
        isEmailVerified: false,
      });
      expect(userRepository.save).toHaveBeenCalled();
      expect(result.userId).toBe(savedNewUser.id);
    });

    it('should update email verification status when it changed in Keycloak', async () => {
      const existingUser = {
        id: 'bidclean-uuid-unverified',
        keycloakId: 'kc-sub-001',
        email: 'maria@example.com',
        fullName: 'Maria Lopez',
        isEmailVerified: false,
      };

      const userInfoVerified = {
        sub: 'kc-sub-001',
        email: 'maria@example.com',
        email_verified: true,
        name: 'Maria Lopez',
      };

      const createdSession = { id: 'session-uuid-002' };

      keycloakService.exchangeCodeForTokens.mockResolvedValue(mockTokens);
      keycloakService.getUserInfo.mockResolvedValue(userInfoVerified as any);
      userRepository.findOne.mockResolvedValue(existingUser as any);
      userRepository.save.mockResolvedValue({ ...existingUser, isEmailVerified: true } as any);
      sessionService.createSession.mockResolvedValue(createdSession as any);

      await authService.handleKeycloakCallback(callbackOptions);

      // save should be called to update verification status
      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ isEmailVerified: true }),
      );
    });

    it('should extract session_state from JWT access token payload', async () => {
      const sessionState = 'unique-kc-session-state-abc';
      const tokenWithSessionState = buildMockJwt({ session_state: sessionState, sub: 'kc-sub-001' });

      const tokensWithCustomSession = { ...mockTokens, accessToken: tokenWithSessionState };
      const existingUser = {
        id: 'bidclean-uuid-001',
        keycloakId: 'kc-sub-001',
        email: 'maria@example.com',
        isEmailVerified: true,
      };
      const createdSession = { id: 'session-uuid-003' };

      keycloakService.exchangeCodeForTokens.mockResolvedValue(tokensWithCustomSession);
      keycloakService.getUserInfo.mockResolvedValue(mockUserInfo);
      userRepository.findOne.mockResolvedValue(existingUser as any);
      sessionService.createSession.mockResolvedValue(createdSession as any);

      await authService.handleKeycloakCallback(callbackOptions);

      expect(sessionService.createSession).toHaveBeenCalledWith(
        existingUser.id,
        sessionState,
        callbackOptions.deviceId,
        callbackOptions.ipAddress,
        callbackOptions.userAgent,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Session Metadata Creation (within callback)
  // ---------------------------------------------------------------------------

  describe('session metadata creation', () => {
    const callbackOptions = {
      code: 'auth-code-session-test',
      redirectUri: 'bidclean://callback',
      codeVerifier: 'verifier-session',
      deviceId: 'device-pixel-7',
      ipAddress: '10.0.0.42',
      userAgent: 'BidClean/2.0 Android',
    };

    const sessionState = 'kc-session-meta-123';
    const mockTokens = {
      accessToken: buildMockJwt({ session_state: sessionState, sub: 'kc-sub-meta' }),
      refreshToken: 'refresh-meta',
      expiresIn: 1800,
      tokenType: 'Bearer',
    };

    const mockUserInfo = {
      sub: 'kc-sub-meta',
      email: 'session@example.com',
      email_verified: true,
      name: 'Session User',
    };

    it('should pass correct parameters to sessionService.createSession', async () => {
      const existingUser = {
        id: 'user-uuid-meta',
        keycloakId: 'kc-sub-meta',
        email: 'session@example.com',
        isEmailVerified: true,
      };
      const createdSession = { id: 'session-created-id' };

      keycloakService.exchangeCodeForTokens.mockResolvedValue(mockTokens);
      keycloakService.getUserInfo.mockResolvedValue(mockUserInfo as any);
      userRepository.findOne.mockResolvedValue(existingUser as any);
      sessionService.createSession.mockResolvedValue(createdSession as any);

      await authService.handleKeycloakCallback(callbackOptions);

      expect(sessionService.createSession).toHaveBeenCalledWith(
        existingUser.id,
        sessionState,
        callbackOptions.deviceId,
        callbackOptions.ipAddress,
        callbackOptions.userAgent,
      );
    });

    it('should include sessionId in callback result', async () => {
      const existingUser = {
        id: 'user-uuid-result',
        keycloakId: 'kc-sub-meta',
        email: 'session@example.com',
        isEmailVerified: true,
      };
      const createdSession = { id: 'final-session-id-xyz' };

      keycloakService.exchangeCodeForTokens.mockResolvedValue(mockTokens);
      keycloakService.getUserInfo.mockResolvedValue(mockUserInfo as any);
      userRepository.findOne.mockResolvedValue(existingUser as any);
      sessionService.createSession.mockResolvedValue(createdSession as any);

      const result = await authService.handleKeycloakCallback(callbackOptions);

      expect(result.sessionId).toBe('final-session-id-xyz');
    });
  });
});

// ---------------------------------------------------------------------------
// Helper: Build a mock JWT with a given payload (header.payload.signature)
// ---------------------------------------------------------------------------

function buildMockJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = 'mock-signature';
  return `${header}.${body}.${signature}`;
}
