import { SetMetadata } from '@nestjs/common';
import { RateLimitCategory } from './rate-limit.types';
import { RATE_LIMIT_CATEGORY_KEY } from './rate-limit.guard';

/**
 * Custom decorator to override path-based rate limit category detection.
 *
 * Usage:
 *   @RateLimit(RateLimitCategory.BIOMETRIC)
 *   @Post('sensitive-endpoint')
 *   async sensitiveAction() { ... }
 */
export const RateLimit = (category: RateLimitCategory) =>
  SetMetadata(RATE_LIMIT_CATEGORY_KEY, category);
