import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthSession } from '../entities/auth-session.entity';
import { CreateSessionInput, SessionInfo } from './session.types';

/**
 * Session metadata service.
 *
 * Manages auth_sessions records for device tracking
 * and application-level logout. Does NOT manage tokens —
 * Keycloak owns the token lifecycle.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @InjectRepository(AuthSession)
    private readonly sessionRepository: Repository<AuthSession>,
  ) {}

  /**
   * Create a new session record for a user on a specific device.
   */
  async createSession(
    userId: string,
    keycloakSessionId: string,
    deviceId: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<AuthSession> {
    const session = this.sessionRepository.create({
      userId,
      keycloakSessionId,
      deviceId,
      ipAddress,
      userAgent,
      lastActiveAt: new Date(),
    });

    const savedSession = await this.sessionRepository.save(session);
    this.logger.log(`Session created: ${savedSession.id} for user ${userId} on device ${deviceId}`);

    return savedSession;
  }

  /**
   * Create or update a session for a user+device combination.
   * If the user already has a session on this device, it updates the existing one
   * instead of creating a duplicate.
   */
  async upsertSession(input: CreateSessionInput): Promise<AuthSession> {
    const { userId, keycloakSessionId, deviceId, ipAddress, userAgent } = input;

    const existingSession = await this.findSessionByDevice(userId, deviceId);

    if (existingSession) {
      existingSession.keycloakSessionId = keycloakSessionId;
      existingSession.ipAddress = ipAddress;
      existingSession.userAgent = userAgent;
      existingSession.lastActiveAt = new Date();

      const updatedSession = await this.sessionRepository.save(existingSession);
      this.logger.log(`Session updated: ${updatedSession.id} for user ${userId} on device ${deviceId}`);

      return updatedSession;
    }

    return this.createSession(userId, keycloakSessionId, deviceId, ipAddress, userAgent);
  }

  /**
   * Find a session by its unique ID.
   */
  async findSessionById(sessionId: string): Promise<AuthSession | null> {
    return this.sessionRepository.findOne({ where: { id: sessionId } });
  }

  /**
   * Find an existing session for a specific user on a specific device.
   */
  async findSessionByDevice(userId: string, deviceId: string): Promise<AuthSession | null> {
    return this.sessionRepository.findOne({ where: { userId, deviceId } });
  }

  /**
   * Find a session by its Keycloak session ID.
   * Used for cross-referencing with Keycloak session revocation events.
   */
  async findSessionByKeycloakSessionId(keycloakSessionId: string): Promise<AuthSession | null> {
    return this.sessionRepository.findOne({ where: { keycloakSessionId } });
  }

  /**
   * Get all sessions for a user.
   */
  async findSessionsByUserId(userId: string): Promise<AuthSession[]> {
    return this.sessionRepository.find({ where: { userId } });
  }

  /**
   * Get the count of active sessions for a user.
   */
  async getActiveSessionCount(userId: string): Promise<number> {
    return this.sessionRepository.count({ where: { userId } });
  }

  /**
   * Get a safe/public list of active sessions for a user.
   * Returns SessionInfo (no internal Keycloak IDs exposed).
   */
  async getActiveSessionsInfo(userId: string): Promise<SessionInfo[]> {
    const sessions = await this.findSessionsByUserId(userId);

    return sessions.map((session) => ({
      id: session.id,
      deviceId: session.deviceId,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      lastActiveAt: session.lastActiveAt,
      createdAt: session.createdAt,
    }));
  }

  /**
   * Remove a session by its unique ID.
   */
  async removeSession(sessionId: string): Promise<void> {
    await this.sessionRepository.delete({ id: sessionId });
    this.logger.log(`Session removed: ${sessionId}`);
  }

  /**
   * Remove a session for a specific user on a specific device.
   */
  async removeSessionByDevice(userId: string, deviceId: string): Promise<void> {
    await this.sessionRepository.delete({ userId, deviceId });
    this.logger.log(`Session removed for user ${userId} on device ${deviceId}`);
  }

  /**
   * Remove all sessions for a user (used in "logout all devices").
   */
  async removeAllSessionsForUser(userId: string): Promise<void> {
    await this.sessionRepository.delete({ userId });
    this.logger.log(`All sessions removed for user: ${userId}`);
  }

  /**
   * Update the last_active_at timestamp for a session.
   */
  async updateLastActive(sessionId: string): Promise<void> {
    await this.sessionRepository.update(
      { id: sessionId },
      { lastActiveAt: new Date() },
    );
  }
}
