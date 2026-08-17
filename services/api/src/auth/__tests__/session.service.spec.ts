import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SessionService } from '../session/session.service';
import { AuthSession } from '../entities/auth-session.entity';

type MockRepository = jest.Mocked<
  Pick<Repository<AuthSession>, 'create' | 'save' | 'findOne' | 'find' | 'count' | 'delete' | 'update'>
>;

describe('SessionService', () => {
  let sessionService: SessionService;
  let repository: MockRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        {
          provide: getRepositoryToken(AuthSession),
          useValue: {
            create: jest.fn((entity) => entity),
            save: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
            count: jest.fn(),
            delete: jest.fn(),
            update: jest.fn(),
          },
        },
      ],
    }).compile();

    sessionService = module.get<SessionService>(SessionService);
    repository = module.get(getRepositoryToken(AuthSession));
  });

  // ---------------------------------------------------------------------------
  // Create Session
  // ---------------------------------------------------------------------------

  describe('create session', () => {
    const userId = 'user-uuid-001';
    const keycloakSessionId = 'kc-session-abc';
    const deviceId = 'device-iphone-14';
    const ipAddress = '192.168.1.50';
    const userAgent = 'BidClean/1.0 iOS';

    it('should create a session with correct metadata', async () => {
      const savedSession = {
        id: 'session-uuid-001',
        userId,
        keycloakSessionId,
        deviceId,
        ipAddress,
        userAgent,
        lastActiveAt: new Date(),
        createdAt: new Date(),
      };

      repository.save.mockResolvedValue(savedSession as AuthSession);

      const result = await sessionService.createSession(
        userId,
        keycloakSessionId,
        deviceId,
        ipAddress,
        userAgent,
      );

      expect(repository.create).toHaveBeenCalledWith({
        userId,
        keycloakSessionId,
        deviceId,
        ipAddress,
        userAgent,
        lastActiveAt: expect.any(Date),
      });
      expect(repository.save).toHaveBeenCalled();
      expect(result).toEqual(savedSession);
    });

    it('should set lastActiveAt to current timestamp on creation', async () => {
      const before = new Date();

      repository.save.mockImplementation(async (entity) => ({
        id: 'session-uuid-002',
        ...entity,
        createdAt: new Date(),
      }) as any);

      await sessionService.createSession(userId, keycloakSessionId, deviceId, ipAddress, userAgent);

      const createCall = repository.create.mock.calls[0]![0] as any;
      const after = new Date();

      expect(createCall.lastActiveAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(createCall.lastActiveAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should return the saved session entity', async () => {
      const savedSession = {
        id: 'session-uuid-003',
        userId,
        keycloakSessionId,
        deviceId,
        ipAddress,
        userAgent,
        lastActiveAt: new Date(),
        createdAt: new Date(),
      };

      repository.save.mockResolvedValue(savedSession as AuthSession);

      const result = await sessionService.createSession(userId, keycloakSessionId, deviceId, ipAddress, userAgent);

      expect(result.id).toBe('session-uuid-003');
      expect(result.userId).toBe(userId);
      expect(result.deviceId).toBe(deviceId);
    });
  });

  // ---------------------------------------------------------------------------
  // Upsert Session
  // ---------------------------------------------------------------------------

  describe('upsert session', () => {
    const input = {
      userId: 'user-uuid-010',
      keycloakSessionId: 'kc-session-new',
      deviceId: 'device-pixel-7',
      ipAddress: '10.0.0.1',
      userAgent: 'BidClean/2.0 Android',
    };

    it('should create a new session when no existing session is found for user+device', async () => {
      repository.findOne.mockResolvedValue(null);

      const savedSession = {
        id: 'session-uuid-new',
        ...input,
        lastActiveAt: new Date(),
        createdAt: new Date(),
      };
      repository.save.mockResolvedValue(savedSession as AuthSession);

      const result = await sessionService.upsertSession(input);

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { userId: input.userId, deviceId: input.deviceId },
      });
      expect(repository.create).toHaveBeenCalled();
      expect(result.id).toBe('session-uuid-new');
    });

    it('should update existing session when user already has a session on the same device', async () => {
      const existingSession = {
        id: 'session-uuid-existing',
        userId: input.userId,
        keycloakSessionId: 'kc-session-old',
        deviceId: input.deviceId,
        ipAddress: '192.168.0.1',
        userAgent: 'BidClean/1.0 Android',
        lastActiveAt: new Date('2024-01-01'),
        createdAt: new Date('2024-01-01'),
      };

      repository.findOne.mockResolvedValue(existingSession as AuthSession);

      const updatedSession = {
        ...existingSession,
        keycloakSessionId: input.keycloakSessionId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        lastActiveAt: new Date(),
      };
      repository.save.mockResolvedValue(updatedSession as AuthSession);

      const result = await sessionService.upsertSession(input);

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'session-uuid-existing',
          keycloakSessionId: input.keycloakSessionId,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        }),
      );
      expect(repository.create).not.toHaveBeenCalled();
      expect(result.keycloakSessionId).toBe(input.keycloakSessionId);
    });

    it('should update lastActiveAt when upserting an existing session', async () => {
      const oldDate = new Date('2023-06-01');
      const existingSession = {
        id: 'session-uuid-time',
        userId: input.userId,
        keycloakSessionId: 'kc-old',
        deviceId: input.deviceId,
        ipAddress: '1.1.1.1',
        userAgent: 'Old Agent',
        lastActiveAt: oldDate,
        createdAt: oldDate,
      };

      repository.findOne.mockResolvedValue(existingSession as AuthSession);
      repository.save.mockImplementation(async (entity) => entity as AuthSession);

      const before = new Date();
      await sessionService.upsertSession(input);

      const saveCall = repository.save.mock.calls[0]![0] as any;
      expect(saveCall.lastActiveAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  // ---------------------------------------------------------------------------
  // Find / Query Sessions
  // ---------------------------------------------------------------------------

  describe('find/query sessions', () => {
    it('should find a session by its unique ID', async () => {
      const session = {
        id: 'session-uuid-find',
        userId: 'user-001',
        deviceId: 'device-001',
        keycloakSessionId: 'kc-001',
        lastActiveAt: new Date(),
        createdAt: new Date(),
      };

      repository.findOne.mockResolvedValue(session as AuthSession);

      const result = await sessionService.findSessionById('session-uuid-find');

      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: 'session-uuid-find' } });
      expect(result).toEqual(session);
    });

    it('should return null when session ID does not exist', async () => {
      repository.findOne.mockResolvedValue(null);

      const result = await sessionService.findSessionById('nonexistent-id');

      expect(result).toBeNull();
    });

    it('should find a session by userId and deviceId', async () => {
      const session = {
        id: 'session-device-match',
        userId: 'user-002',
        deviceId: 'device-pixel',
        keycloakSessionId: 'kc-002',
        lastActiveAt: new Date(),
        createdAt: new Date(),
      };

      repository.findOne.mockResolvedValue(session as AuthSession);

      const result = await sessionService.findSessionByDevice('user-002', 'device-pixel');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { userId: 'user-002', deviceId: 'device-pixel' },
      });
      expect(result).toEqual(session);
    });

    it('should find a session by keycloak session ID', async () => {
      const session = {
        id: 'session-kc-match',
        userId: 'user-003',
        deviceId: 'device-003',
        keycloakSessionId: 'kc-unique-session-id',
        lastActiveAt: new Date(),
        createdAt: new Date(),
      };

      repository.findOne.mockResolvedValue(session as AuthSession);

      const result = await sessionService.findSessionByKeycloakSessionId('kc-unique-session-id');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { keycloakSessionId: 'kc-unique-session-id' },
      });
      expect(result).toEqual(session);
    });

    it('should return all sessions for a given user', async () => {
      const sessions = [
        { id: 'session-a', userId: 'user-multi', deviceId: 'device-a' },
        { id: 'session-b', userId: 'user-multi', deviceId: 'device-b' },
        { id: 'session-c', userId: 'user-multi', deviceId: 'device-c' },
      ];

      repository.find.mockResolvedValue(sessions as AuthSession[]);

      const result = await sessionService.findSessionsByUserId('user-multi');

      expect(repository.find).toHaveBeenCalledWith({ where: { userId: 'user-multi' } });
      expect(result).toHaveLength(3);
    });

    it('should return the count of active sessions for a user', async () => {
      repository.count.mockResolvedValue(5);

      const result = await sessionService.getActiveSessionCount('user-count');

      expect(repository.count).toHaveBeenCalledWith({ where: { userId: 'user-count' } });
      expect(result).toBe(5);
    });

    it('should return safe session info without keycloakSessionId', async () => {
      const sessions = [
        {
          id: 'session-info-1',
          userId: 'user-info',
          keycloakSessionId: 'kc-secret-1',
          deviceId: 'device-info-1',
          ipAddress: '10.0.0.1',
          userAgent: 'BidClean/1.0',
          lastActiveAt: new Date('2024-03-01'),
          createdAt: new Date('2024-02-01'),
        },
        {
          id: 'session-info-2',
          userId: 'user-info',
          keycloakSessionId: 'kc-secret-2',
          deviceId: 'device-info-2',
          ipAddress: '10.0.0.2',
          userAgent: 'BidClean/2.0',
          lastActiveAt: new Date('2024-03-15'),
          createdAt: new Date('2024-02-15'),
        },
      ];

      repository.find.mockResolvedValue(sessions as AuthSession[]);

      const result = await sessionService.getActiveSessionsInfo('user-info');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'session-info-1',
        deviceId: 'device-info-1',
        ipAddress: '10.0.0.1',
        userAgent: 'BidClean/1.0',
        lastActiveAt: new Date('2024-03-01'),
        createdAt: new Date('2024-02-01'),
      });
      // Verify keycloakSessionId is NOT in the output
      expect(result[0]).not.toHaveProperty('keycloakSessionId');
      expect(result[1]).not.toHaveProperty('keycloakSessionId');
    });

    it('should return empty array when user has no sessions', async () => {
      repository.find.mockResolvedValue([]);

      const result = await sessionService.getActiveSessionsInfo('user-no-sessions');

      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Revoke Single Session
  // ---------------------------------------------------------------------------

  describe('revoke single session', () => {
    it('should remove only the targeted session by ID', async () => {
      await sessionService.removeSession('session-to-delete');

      expect(repository.delete).toHaveBeenCalledWith({ id: 'session-to-delete' });
    });

    it('should not affect other sessions when removing by ID', async () => {
      await sessionService.removeSession('session-specific');

      expect(repository.delete).toHaveBeenCalledTimes(1);
      expect(repository.delete).toHaveBeenCalledWith({ id: 'session-specific' });
    });

    it('should remove a session for a specific user on a specific device', async () => {
      await sessionService.removeSessionByDevice('user-device-del', 'device-remove');

      expect(repository.delete).toHaveBeenCalledWith({
        userId: 'user-device-del',
        deviceId: 'device-remove',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Revoke All Sessions
  // ---------------------------------------------------------------------------

  describe('revoke all sessions', () => {
    it('should remove all sessions for a user', async () => {
      await sessionService.removeAllSessionsForUser('user-logout-all');

      expect(repository.delete).toHaveBeenCalledWith({ userId: 'user-logout-all' });
    });

    it('should call repository.delete with only the userId filter', async () => {
      await sessionService.removeAllSessionsForUser('user-uuid-all');

      const deleteArg = repository.delete.mock.calls[0]![0];
      expect(deleteArg).toEqual({ userId: 'user-uuid-all' });
      expect(Object.keys(deleteArg as object)).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Update Session
  // ---------------------------------------------------------------------------

  describe('update session', () => {
    it('should update lastActiveAt timestamp for a session', async () => {
      const before = new Date();

      await sessionService.updateLastActive('session-update-active');

      expect(repository.update).toHaveBeenCalledWith(
        { id: 'session-update-active' },
        { lastActiveAt: expect.any(Date) },
      );

      const updateCall = repository.update.mock.calls[0]![1] as any;
      const after = new Date();
      expect(updateCall.lastActiveAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(updateCall.lastActiveAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should target the correct session by ID when updating', async () => {
      await sessionService.updateLastActive('session-target-id');

      const filterArg = repository.update.mock.calls[0]![0];
      expect(filterArg).toEqual({ id: 'session-target-id' });
    });
  });
});
