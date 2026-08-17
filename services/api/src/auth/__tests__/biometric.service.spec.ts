import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GoneException, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { BiometricService } from '../biometric/biometric.service';
import { BiometricCredential } from '../entities/biometric-credential.entity';
import { BiometricChallenge } from '../entities/biometric-challenge.entity';
import { User } from '../entities/user.entity';
import { KeycloakService } from '../keycloak/keycloak.service';

describe('BiometricService', () => {
  let service: BiometricService;
  let findOneMock: jest.Mock;
  let createMock: jest.Mock;
  let saveMock: jest.Mock;
  let removeMock: jest.Mock;
  let challengeFindOneMock: jest.Mock;
  let challengeCreateMock: jest.Mock;
  let challengeSaveMock: jest.Mock;
  let userFindOneMock: jest.Mock;
  let keycloakGetTokensForUser: jest.Mock;

  beforeEach(async () => {
    findOneMock = jest.fn();
    createMock = jest.fn();
    saveMock = jest.fn();
    removeMock = jest.fn();
    challengeFindOneMock = jest.fn();
    challengeCreateMock = jest.fn((entity) => entity);
    challengeSaveMock = jest.fn((entity) => Promise.resolve({ id: 'challenge-1', ...entity }));
    userFindOneMock = jest.fn();
    keycloakGetTokensForUser = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BiometricService,
        {
          provide: getRepositoryToken(BiometricCredential),
          useValue: {
            findOne: findOneMock,
            create: createMock,
            save: saveMock,
            remove: removeMock,
          },
        },
        {
          provide: getRepositoryToken(BiometricChallenge),
          useValue: {
            findOne: challengeFindOneMock,
            create: challengeCreateMock,
            save: challengeSaveMock,
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: userFindOneMock,
          },
        },
        {
          provide: KeycloakService,
          useValue: {
            getTokensForUser: keycloakGetTokensForUser,
          },
        },
      ],
    }).compile();

    service = module.get<BiometricService>(BiometricService);
  });

  describe('registerCredential', () => {
    const baseOptions = {
      userId: 'user-123',
      deviceId: 'device-abc',
      publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...',
      credentialType: 'fingerprint',
    };

    it('should create a new credential when none exists', async () => {
      findOneMock.mockResolvedValue(null);
      createMock.mockReturnValue({
        id: 'cred-1',
        ...baseOptions,
        createdAt: new Date(),
        lastUsedAt: null,
        revokedAt: null,
      });
      saveMock.mockResolvedValue({
        id: 'cred-1',
        ...baseOptions,
        createdAt: new Date(),
        lastUsedAt: null,
        revokedAt: null,
      });

      await service.registerCredential(baseOptions);

      expect(findOneMock).toHaveBeenCalledWith({
        where: { userId: 'user-123', deviceId: 'device-abc' },
      });
      expect(createMock).toHaveBeenCalledWith({
        userId: 'user-123',
        deviceId: 'device-abc',
        publicKey: baseOptions.publicKey,
        credentialType: 'fingerprint',
      });
      expect(saveMock).toHaveBeenCalled();
    });

    it('should update public key when active credential exists for same user+device', async () => {
      const existingCredential = {
        id: 'cred-1',
        userId: 'user-123',
        deviceId: 'device-abc',
        publicKey: 'old-public-key',
        credentialType: 'face_id',
        createdAt: new Date(),
        lastUsedAt: null,
        revokedAt: null,
      };

      findOneMock.mockResolvedValue(existingCredential);
      saveMock.mockResolvedValue({
        ...existingCredential,
        publicKey: baseOptions.publicKey,
        credentialType: 'fingerprint',
      });

      await service.registerCredential(baseOptions);

      expect(saveMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'cred-1',
          publicKey: baseOptions.publicKey,
          credentialType: 'fingerprint',
        }),
      );
      expect(removeMock).not.toHaveBeenCalled();
    });

    it('should remove revoked credential and create new one', async () => {
      const revokedCredential = {
        id: 'cred-1',
        userId: 'user-123',
        deviceId: 'device-abc',
        publicKey: 'old-revoked-key',
        credentialType: 'face_id',
        createdAt: new Date(),
        lastUsedAt: null,
        revokedAt: new Date('2024-01-01'),
      };

      findOneMock.mockResolvedValue(revokedCredential);
      removeMock.mockResolvedValue(revokedCredential);
      createMock.mockReturnValue({
        id: 'cred-2',
        ...baseOptions,
        createdAt: new Date(),
        lastUsedAt: null,
        revokedAt: null,
      });
      saveMock.mockResolvedValue({
        id: 'cred-2',
        ...baseOptions,
        createdAt: new Date(),
        lastUsedAt: null,
        revokedAt: null,
      });

      await service.registerCredential(baseOptions);

      expect(removeMock).toHaveBeenCalledWith(revokedCredential);
      expect(createMock).toHaveBeenCalledWith({
        userId: 'user-123',
        deviceId: 'device-abc',
        publicKey: baseOptions.publicKey,
        credentialType: 'fingerprint',
      });
      expect(saveMock).toHaveBeenCalled();
    });

    it('should query with correct userId and deviceId', async () => {
      findOneMock.mockResolvedValue(null);
      createMock.mockReturnValue({ id: 'cred-3', ...baseOptions });
      saveMock.mockResolvedValue({ id: 'cred-3', ...baseOptions });

      await service.registerCredential({
        ...baseOptions,
        userId: 'other-user',
      });

      expect(findOneMock).toHaveBeenCalledWith({
        where: { userId: 'other-user', deviceId: 'device-abc' },
      });
    });
  });

  describe('generateChallenge', () => {
    it('should return a challenge with nonce and expiresAt', async () => {
      const result = await service.generateChallenge('device-abc');

      expect(result).toHaveProperty('challenge');
      expect(result).toHaveProperty('expiresAt');
      expect(typeof result.challenge).toBe('string');
      expect(typeof result.expiresAt).toBe('string');
    });

    it('should generate a base64url-encoded 32-byte nonce (43 characters)', async () => {
      const result = await service.generateChallenge('device-abc');

      // 32 bytes in base64url = 43 characters
      expect(result.challenge).toHaveLength(43);
      // Verify it is valid base64url (no +, /, or = characters)
      expect(result.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should set expiresAt approximately 30 seconds in the future', async () => {
      const before = Date.now();
      const result = await service.generateChallenge('device-abc');
      const after = Date.now();

      const expiresAtMs = new Date(result.expiresAt).getTime();

      expect(expiresAtMs).toBeGreaterThanOrEqual(before + 30_000);
      expect(expiresAtMs).toBeLessThanOrEqual(after + 30_000);
    });

    it('should save the challenge with deviceId, nonce, expiresAt, and used=false', async () => {
      await service.generateChallenge('device-xyz');

      expect(challengeCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceId: 'device-xyz',
          used: false,
        }),
      );
      expect(challengeCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          nonce: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      );
      expect(challengeSaveMock).toHaveBeenCalled();
    });

    it('should generate unique nonces across multiple calls', async () => {
      const result1 = await service.generateChallenge('device-abc');
      const result2 = await service.generateChallenge('device-abc');

      expect(result1.challenge).not.toBe(result2.challenge);
    });
  });

  describe('verifyChallenge', () => {
    // Generate a real EC key pair for signature tests
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const nonce = 'test-nonce-value';
    const deviceId = 'device-abc';
    const validSignature = crypto.sign('SHA256', Buffer.from(nonce), privateKey).toString('base64');

    const mockChallenge = {
      id: 'challenge-1',
      deviceId,
      nonce,
      expiresAt: new Date(Date.now() + 30_000),
      used: false,
    };

    const mockCredential = {
      id: 'cred-1',
      userId: 'user-123',
      deviceId,
      publicKey: publicKey as string,
      credentialType: 'ec',
      lastUsedAt: null,
      revokedAt: null,
    };

    const mockUser = {
      id: 'user-123',
      keycloakId: 'kc-user-uuid',
      email: 'test@test.com',
    };

    const mockTokens = {
      accessToken: 'access-token-123',
      refreshToken: 'refresh-token-456',
      expiresIn: 900,
      tokenType: 'Bearer',
    };

    it('should return tokens on successful verification', async () => {
      challengeFindOneMock.mockResolvedValue({ ...mockChallenge });
      challengeSaveMock.mockResolvedValue({ ...mockChallenge, used: true });
      findOneMock.mockResolvedValue({ ...mockCredential });
      saveMock.mockResolvedValue({ ...mockCredential, lastUsedAt: new Date() });
      userFindOneMock.mockResolvedValue(mockUser);
      keycloakGetTokensForUser.mockResolvedValue(mockTokens);

      const result = await service.verifyChallenge({
        deviceId,
        challenge: nonce,
        signature: validSignature,
      });

      expect(result).toEqual(mockTokens);
      expect(keycloakGetTokensForUser).toHaveBeenCalledWith('kc-user-uuid');
    });

    it('should throw GoneException when challenge is not found', async () => {
      challengeFindOneMock.mockResolvedValue(null);

      await expect(
        service.verifyChallenge({ deviceId, challenge: nonce, signature: validSignature }),
      ).rejects.toThrow(GoneException);
    });

    it('should throw GoneException when challenge is already used', async () => {
      challengeFindOneMock.mockResolvedValue({ ...mockChallenge, used: true });

      await expect(
        service.verifyChallenge({ deviceId, challenge: nonce, signature: validSignature }),
      ).rejects.toThrow(GoneException);
    });

    it('should throw GoneException when challenge is expired', async () => {
      challengeFindOneMock.mockResolvedValue({
        ...mockChallenge,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.verifyChallenge({ deviceId, challenge: nonce, signature: validSignature }),
      ).rejects.toThrow(GoneException);
    });

    it('should mark challenge as used after validation', async () => {
      challengeFindOneMock.mockResolvedValue({ ...mockChallenge });
      challengeSaveMock.mockResolvedValue({ ...mockChallenge, used: true });
      findOneMock.mockResolvedValue({ ...mockCredential });
      saveMock.mockResolvedValue({ ...mockCredential, lastUsedAt: new Date() });
      userFindOneMock.mockResolvedValue(mockUser);
      keycloakGetTokensForUser.mockResolvedValue(mockTokens);

      await service.verifyChallenge({ deviceId, challenge: nonce, signature: validSignature });

      expect(challengeSaveMock).toHaveBeenCalledWith(
        expect.objectContaining({ used: true }),
      );
    });

    it('should throw UnauthorizedException when no active credential found', async () => {
      challengeFindOneMock.mockResolvedValue({ ...mockChallenge });
      challengeSaveMock.mockResolvedValue({ ...mockChallenge, used: true });
      findOneMock.mockResolvedValue(null);

      await expect(
        service.verifyChallenge({ deviceId, challenge: nonce, signature: validSignature }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when signature is invalid', async () => {
      challengeFindOneMock.mockResolvedValue({ ...mockChallenge });
      challengeSaveMock.mockResolvedValue({ ...mockChallenge, used: true });
      findOneMock.mockResolvedValue({ ...mockCredential });

      await expect(
        service.verifyChallenge({ deviceId, challenge: nonce, signature: 'invalid-sig' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user is not found', async () => {
      challengeFindOneMock.mockResolvedValue({ ...mockChallenge });
      challengeSaveMock.mockResolvedValue({ ...mockChallenge, used: true });
      findOneMock.mockResolvedValue({ ...mockCredential });
      saveMock.mockResolvedValue({ ...mockCredential });
      userFindOneMock.mockResolvedValue(null);

      await expect(
        service.verifyChallenge({ deviceId, challenge: nonce, signature: validSignature }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should update lastUsedAt on credential after successful verification', async () => {
      const credential = { ...mockCredential };
      challengeFindOneMock.mockResolvedValue({ ...mockChallenge });
      challengeSaveMock.mockResolvedValue({ ...mockChallenge, used: true });
      findOneMock.mockResolvedValue(credential);
      saveMock.mockResolvedValue({ ...credential, lastUsedAt: new Date() });
      userFindOneMock.mockResolvedValue(mockUser);
      keycloakGetTokensForUser.mockResolvedValue(mockTokens);

      await service.verifyChallenge({ deviceId, challenge: nonce, signature: validSignature });

      expect(saveMock).toHaveBeenCalledWith(
        expect.objectContaining({ lastUsedAt: expect.any(Date) }),
      );
    });
  });
});
