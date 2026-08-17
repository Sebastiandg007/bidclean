/**
 * Rate limiting types and configuration.
 *
 * Defines categories, thresholds, and configuration
 * for the Redis-backed rate limiting guard.
 */

export enum RateLimitCategory {
  AUTH = 'auth',
  BIOMETRIC = 'biometric',
  GENERAL = 'general',
}

export interface RateLimitConfig {
  readonly points: number;
  readonly duration: number;
  readonly keyPrefix: string;
}

export const RATE_LIMIT_DEFAULTS: Record<RateLimitCategory, RateLimitConfig> = {
  [RateLimitCategory.AUTH]: {
    points: 10,
    duration: 60,
    keyPrefix: 'rate_limit:auth',
  },
  [RateLimitCategory.BIOMETRIC]: {
    points: 5,
    duration: 60,
    keyPrefix: 'rate_limit:biometric',
  },
  [RateLimitCategory.GENERAL]: {
    points: 30,
    duration: 60,
    keyPrefix: 'rate_limit:general',
  },
};
