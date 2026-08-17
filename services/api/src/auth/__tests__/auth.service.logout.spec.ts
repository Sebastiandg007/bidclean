import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthService } from '../auth.service';
import { KeycloakService } from '../keycloak/keycloak.service';
import { EmailVerificationSyncService } from '../keycloak/email-verification-sync.service';
import { SessionService } from '../session/session.service';
import { BiometricService } from '../biometric/biometric.service';
import { User } from '../entities/user.entity';

describe('AuthService — logout', () => {
  let authService: AuthService;
  let keycloakService: jest.Mocked<Pick<KeycloakService, 'revokeSession'>>;
  let sessionService: jest.Mocked<Pick<SessionService, 'findSessionByKeycloakSessionId' | 'removeSession'>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: KeycloakService,
          useValue: {
            revokeSession: jest.fn().mockResolvedValue(undefined),
            createUser: jest.fn(),
            getAuthorizationUrl: jest.fn(),
            getRedirectUri: jest.fn(),
            exchangeCodeForTokens: jest.fn(),
            getUserInfo: jest.fn(),
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
            findSessionByKeycloakSessionId: jest.fn(),
            removeSession: jest.fn().mockResolvedValue(undefined),
            createSession: jest.fn(),
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
            create: jest.fn(),
            save: jest.fn(),
          },
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    keycloakService = module.get(KeycloakService);
    sessionService = module.get(SessionService);
  });

  it('should revoke Keycloak session and remove local session', async () => {
    const keycloakSessionId = 'kc-session-abc-123';
    const localSession = { id: 'local-session-uuid', keycloakSessionId };

    sessionService.findSessionByKeycloakSessionId.mockResolvedValue(localSession as any);

    const result = await authService.logout(keycloakSessionId);

    expect(keycloakService.revokeSession).toHaveBeenCalledWith(keycloakSessionId);
    expect(sessionService.findSessionByKeycloakSessionId).toHaveBeenCalledWith(keycloakSessionId);
    expect(sessionService.removeSession).toHaveBeenCalledWith(localSession.id);
    expect(result).toEqual({ message: 'Logged out successfully' });
  });

  it('should still revoke Keycloak session when no local session exists', async () => {
    const keycloakSessionId = 'kc-session-orphan-456';

    sessionService.findSessionByKeycloakSessionId.mockResolvedValue(null);

    const result = await authService.logout(keycloakSessionId);

    expect(keycloakService.revokeSession).toHaveBeenCalledWith(keycloakSessionId);
    expect(sessionService.removeSession).not.toHaveBeenCalled();
    expect(result).toEqual({ message: 'Logged out successfully' });
  });

  it('should handle missing sessionState gracefully', async () => {
    const result = await authService.logout(undefined);

    expect(keycloakService.revokeSession).not.toHaveBeenCalled();
    expect(sessionService.findSessionByKeycloakSessionId).not.toHaveBeenCalled();
    expect(result).toEqual({ message: 'Logged out successfully' });
  });
});
