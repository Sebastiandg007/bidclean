import Redis from 'ioredis';

/**
 * Redis configuration.
 *
 * Creates a shared ioredis client instance using the REDIS_URL
 * environment variable. Used by rate limiting and other Redis-backed features.
 */

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    });
  }
  return redisClient;
}

export const REDIS_CLIENT_TOKEN = 'REDIS_CLIENT';
