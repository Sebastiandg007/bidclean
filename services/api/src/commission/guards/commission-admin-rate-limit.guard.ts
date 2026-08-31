import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { getRedisClient } from '../../config/redis.config';
import {
  COMMISSION_ADMIN_RATE_LIMIT_PER_MINUTE,
} from '../commission.constants';
import { JwtUserPayload } from '../../auth/guards/jwt.types';

/**
 * Per-operator rate limit for commission-rule admin endpoints.
 *
 * Limits writes to COMMISSION_ADMIN_RATE_LIMIT_PER_MINUTE per authenticated operator per
 * minute, backed by Redis. Fail-open if Redis is unavailable (never blocks all admin traffic).
 * Must run AFTER JwtAuthGuard.
 */
@Injectable()
export class CommissionAdminRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(CommissionAdminRateLimitGuard.name);
  private readonly limiter: RateLimiterRedis;

  constructor() {
    this.limiter = new RateLimiterRedis({
      storeClient: getRedisClient(),
      keyPrefix: 'rl:commission-admin',
      points: COMMISSION_ADMIN_RATE_LIMIT_PER_MINUTE,
      duration: 60,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user: JwtUserPayload }>();
    const key = request.user?.keycloakId ?? request.ip ?? '0.0.0.0';

    try {
      await this.limiter.consume(key);
      return true;
    } catch (error) {
      if (error instanceof RateLimiterRes) {
        const retryAfter = Math.ceil(error.msBeforeNext / 1000);
        throw new HttpException(
          { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Too many requests', retryAfter },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      this.logger.error(`Rate limiter error (fail-open): ${(error as Error).message}`);
      return true;
    }
  }
}
