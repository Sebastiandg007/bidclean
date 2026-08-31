import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { getRedisClient } from '../config/redis.config';
import { CommissionRulesCache } from './commission-rules.cache';
import {
  COMMISSION_CACHE_INVALIDATION_CHANNEL,
  COMMISSION_RULES_CACHE_TTL_MS,
} from './commission.constants';

/**
 * Cross-instance commission ruleset cache invalidation via Redis pub/sub.
 *
 * When any API instance writes a rule it calls `publishInvalidation()`, which refreshes
 * the local cache immediately AND publishes a message on the invalidation channel. Every
 * instance runs a dedicated subscriber connection (ioredis requires a separate connection
 * for subscribe mode) and refreshes its cache on each message — so no instance serves a
 * stale commission rate after a change. Publish/subscribe failures are logged and never
 * throw into a write path (the DB write remains the source of truth).
 */
@Injectable()
export class CommissionCacheInvalidation implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommissionCacheInvalidation.name);
  private subscriber: Redis | null = null;
  private ttlTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly cache: CommissionRulesCache) {}

  async onModuleInit(): Promise<void> {
    // Load the initial snapshot so resolution works from the first request.
    await this.cache.refresh();

    // Dedicated subscriber connection (a subscribed ioredis client cannot issue other commands).
    try {
      this.subscriber = getRedisClient().duplicate();
      await this.subscriber.subscribe(COMMISSION_CACHE_INVALIDATION_CHANNEL);
      this.subscriber.on('message', (channel: string) => {
        if (channel === COMMISSION_CACHE_INVALIDATION_CHANNEL) {
          void this.cache.refresh();
        }
      });
    } catch (error) {
      this.logger.error(
        'Failed to subscribe to commission cache invalidation channel; ' +
          'this instance will rely on the TTL refresh only',
        error instanceof Error ? error.stack : String(error),
      );
    }

    // Periodic TTL refresh as a backstop, so an instance still converges to the durable
    // ruleset even if a pub/sub message is missed or the subscriber failed to connect.
    this.ttlTimer = setInterval(() => {
      void this.cache.refresh();
    }, COMMISSION_RULES_CACHE_TTL_MS);
    // Do not keep the event loop alive solely for this timer.
    if (typeof this.ttlTimer.unref === 'function') {
      this.ttlTimer.unref();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.ttlTimer) {
      clearInterval(this.ttlTimer);
      this.ttlTimer = null;
    }
    if (this.subscriber) {
      try {
        await this.subscriber.unsubscribe(COMMISSION_CACHE_INVALIDATION_CHANNEL);
        await this.subscriber.quit();
      } catch {
        // best-effort teardown
      }
      this.subscriber = null;
    }
  }

  /**
   * Refresh this instance immediately and notify all other instances to refresh.
   * Never throws — a publish failure must not fail the originating rule write.
   */
  async publishInvalidation(): Promise<void> {
    await this.cache.refresh();
    try {
      await getRedisClient().publish(COMMISSION_CACHE_INVALIDATION_CHANNEL, '1');
    } catch (error) {
      this.logger.error(
        'Failed to publish commission cache invalidation; other instances will ' +
          'converge on the TTL refresh',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
