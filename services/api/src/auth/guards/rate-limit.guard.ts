import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { getRedisClient } from '../../config/redis.config';
import {
  RateLimitCategory,
  RateLimitConfig,
  RATE_LIMIT_DEFAULTS,
} from './rate-limit.types';

export const RATE_LIMIT_CATEGORY_KEY = 'rate_limit_category';

/**
 * Rate limiting guard.
 *
 * Enforces per-IP request limits using Redis as the backing store.
 * Configurable thresholds per endpoint type (auth, biometric, general).
 *
 * Fail-open strategy: if Redis is unavailable, requests are allowed
 * through to avoid blocking all traffic.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly limiters: Map<RateLimitCategory, RateLimiterRedis>;

  constructor(private readonly reflector: Reflector) {
    this.limiters = this.createLimiters();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const clientIp = this.extractClientIp(request);
    const category = this.resolveCategory(context, request);
    const limiter = this.limiters.get(category);

    if (!limiter) {
      return true;
    }

    try {
      await limiter.consume(clientIp);
      return true;
    } catch (error) {
      if (error instanceof RateLimiterRes) {
        const retryAfter = Math.ceil(error.msBeforeNext / 1000);
        this.logger.warn(
          `Rate limit exceeded for ${clientIp} on category=${category}`,
        );
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'Too many requests',
            retryAfter,
          },
          HttpStatus.TOO_MANY_REQUESTS,
          {
            description: `Retry-After: ${retryAfter}`,
          },
        );
      }

      // Fail-open: if Redis connection fails, allow the request
      this.logger.error(
        `Rate limiter error (fail-open): ${(error as Error).message}`,
      );
      return true;
    }
  }

  private createLimiters(): Map<RateLimitCategory, RateLimiterRedis> {
    const limiters = new Map<RateLimitCategory, RateLimiterRedis>();
    const redisClient = getRedisClient();

    const configs = this.loadConfigs();

    for (const [category, config] of Object.entries(configs)) {
      const limiter = new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: config.keyPrefix,
        points: config.points,
        duration: config.duration,
      });
      limiters.set(category as RateLimitCategory, limiter);
    }

    return limiters;
  }

  private loadConfigs(): Record<RateLimitCategory, RateLimitConfig> {
    return {
      [RateLimitCategory.AUTH]: {
        points: this.envInt('RATE_LIMIT_AUTH_POINTS', RATE_LIMIT_DEFAULTS[RateLimitCategory.AUTH].points),
        duration: this.envInt('RATE_LIMIT_AUTH_DURATION', RATE_LIMIT_DEFAULTS[RateLimitCategory.AUTH].duration),
        keyPrefix: RATE_LIMIT_DEFAULTS[RateLimitCategory.AUTH].keyPrefix,
      },
      [RateLimitCategory.BIOMETRIC]: {
        points: this.envInt('RATE_LIMIT_BIOMETRIC_POINTS', RATE_LIMIT_DEFAULTS[RateLimitCategory.BIOMETRIC].points),
        duration: this.envInt('RATE_LIMIT_BIOMETRIC_DURATION', RATE_LIMIT_DEFAULTS[RateLimitCategory.BIOMETRIC].duration),
        keyPrefix: RATE_LIMIT_DEFAULTS[RateLimitCategory.BIOMETRIC].keyPrefix,
      },
      [RateLimitCategory.GENERAL]: {
        points: this.envInt('RATE_LIMIT_GENERAL_POINTS', RATE_LIMIT_DEFAULTS[RateLimitCategory.GENERAL].points),
        duration: this.envInt('RATE_LIMIT_GENERAL_DURATION', RATE_LIMIT_DEFAULTS[RateLimitCategory.GENERAL].duration),
        keyPrefix: RATE_LIMIT_DEFAULTS[RateLimitCategory.GENERAL].keyPrefix,
      },
    };
  }

  private resolveCategory(context: ExecutionContext, request: Request): RateLimitCategory {
    // Check for explicit decorator override first
    const decoratorCategory = this.reflector.getAllAndOverride<RateLimitCategory | undefined>(
      RATE_LIMIT_CATEGORY_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (decoratorCategory) {
      return decoratorCategory;
    }

    // Fall back to path-based detection
    return this.detectCategoryFromPath(request.path);
  }

  private detectCategoryFromPath(path: string): RateLimitCategory {
    const normalizedPath = path.toLowerCase();

    if (normalizedPath.includes('biometric')) {
      return RateLimitCategory.BIOMETRIC;
    }

    if (
      normalizedPath.includes('register') ||
      normalizedPath.includes('login') ||
      normalizedPath.includes('callback')
    ) {
      return RateLimitCategory.AUTH;
    }

    return RateLimitCategory.GENERAL;
  }

  private extractClientIp(request: Request): string {
    const forwardedFor = request.headers['x-forwarded-for'];
    if (forwardedFor) {
      const firstIp = Array.isArray(forwardedFor)
        ? forwardedFor[0]
        : forwardedFor.split(',')[0];
      return firstIp?.trim() || '0.0.0.0';
    }
    return request.ip || '0.0.0.0';
  }

  private envInt(key: string, defaultValue: number): number {
    const value = process.env[key];
    if (!value) {
      return defaultValue;
    }
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }
}
