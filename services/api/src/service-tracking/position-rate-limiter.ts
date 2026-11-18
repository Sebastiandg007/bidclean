import { Injectable, Logger } from '@nestjs/common';

import { getRedisClient } from '../config/redis.config';
import { SERVICE_POSITION_MIN_INTERVAL_MS } from './service-tracking.constants';

/**
 * The minimal Redis surface the rate limiter needs. `set(key, val, 'PX', ttlMs, 'NX')` returns
 * `'OK'` when the key did not exist (the sample is accepted) and `null` when it did (throttled).
 * Declared as an interface so tests inject a fake without a live Redis.
 */
export interface RateLimiterRedisClient {
  set(
    key: string,
    value: string,
    px: 'PX',
    ttlMs: number,
    nx: 'NX',
  ): Promise<'OK' | null>;
}

/**
 * PositionRateLimiter — server-side throttle per `(user, session)` (Spec 17, Option A).
 *
 * NEVER trusts the client to self-limit. Accepts at most one sample per
 * `SERVICE_POSITION_MIN_INTERVAL_MS` per `(user, session)` using a Redis `SET NX PX` window: the
 * first sample in a window sets a short-lived key and is accepted; a sample arriving before the key
 * expires finds it present and is dropped (ignored, never errored) — bounding CPU/PostGIS/Centrifugo
 * load. A Redis failure fails OPEN (accepts) so a transient cache blip never blocks legitimate
 * tracking; correctness never depends on the rate limiter.
 */
@Injectable()
export class PositionRateLimiter {
  private readonly logger = new Logger(PositionRateLimiter.name);
  private readonly redis: RateLimiterRedisClient;
  private readonly intervalMs: number;

  constructor(redis?: RateLimiterRedisClient, intervalMs: number = SERVICE_POSITION_MIN_INTERVAL_MS) {
    this.redis = redis ?? (getRedisClient() as unknown as RateLimiterRedisClient);
    this.intervalMs = intervalMs;
  }

  /**
   * Whether a sample from `(userId, sessionId)` should be accepted now. True when at least
   * `intervalMs` has elapsed since the last accepted sample for the pair; false otherwise.
   */
  async shouldAccept(userId: string, sessionId: string, now: number): Promise<boolean> {
    const key = `st:pos:${sessionId}:${userId}`;
    try {
      const result = await this.redis.set(key, String(now), 'PX', this.intervalMs, 'NX');
      return result === 'OK';
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Rate-limit check failed (fail-open): ${reason}`);
      return true;
    }
  }
}
