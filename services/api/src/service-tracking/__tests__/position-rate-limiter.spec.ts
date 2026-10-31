import * as fc from 'fast-check';

import { PositionRateLimiter, RateLimiterRedisClient } from '../position-rate-limiter';

/**
 * Unit + property tests for PositionRateLimiter (Spec 17).
 *
 * A fake Redis models `SET NX PX`: the key is present until its window expires; the first sample in
 * a window is accepted (`'OK'`), a sample within the window is dropped (`null`). Per-(user,session)
 * isolation is verified by distinct keys.
 */

const INTERVAL_MS = 3000;

/** A minimal in-memory `SET NX PX` fake keyed by the limiter's composite key. */
class FakeRedis implements RateLimiterRedisClient {
  private readonly expiry = new Map<string, number>();
  failNext = false;

  async set(key: string, value: string, _px: 'PX', ttlMs: number, _nx: 'NX'): Promise<'OK' | null> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('redis down');
    }
    const now = Number(value);
    const currentExpiry = this.expiry.get(key);
    if (currentExpiry !== undefined && currentExpiry > now) {
      return null;
    }
    this.expiry.set(key, now + ttlMs);
    return 'OK';
  }
}

function buildLimiter(redis: RateLimiterRedisClient): PositionRateLimiter {
  return new PositionRateLimiter(redis, INTERVAL_MS);
}

describe('PositionRateLimiter', () => {
  it('accepts the first sample and drops one within the interval', async () => {
    const limiter = buildLimiter(new FakeRedis());
    expect(await limiter.shouldAccept('u1', 's1', 0)).toBe(true);
    expect(await limiter.shouldAccept('u1', 's1', 1000)).toBe(false);
    expect(await limiter.shouldAccept('u1', 's1', INTERVAL_MS)).toBe(true);
  });

  it('isolates per (user, session)', async () => {
    const limiter = buildLimiter(new FakeRedis());
    expect(await limiter.shouldAccept('u1', 's1', 0)).toBe(true);
    // Same instant, different user or session → not throttled.
    expect(await limiter.shouldAccept('u2', 's1', 0)).toBe(true);
    expect(await limiter.shouldAccept('u1', 's2', 0)).toBe(true);
  });

  it('fails open when Redis errors (correctness never depends on the limiter)', async () => {
    const redis = new FakeRedis();
    redis.failNext = true;
    const limiter = buildLimiter(redis);
    expect(await limiter.shouldAccept('u1', 's1', 0)).toBe(true);
  });

  // Feature: service-tracking, Property 8: accepted samples are spaced ≥ MIN_INTERVAL apart.
  it('P8 (rate limiting): accepted samples for a pair are spaced ≥ interval; excess dropped', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 60000 }), { minLength: 1, maxLength: 40 }),
        async (offsets) => {
          const limiter = buildLimiter(new FakeRedis());
          const times = [...offsets].sort((a, b) => a - b);
          let lastAccepted: number | null = null;
          for (const t of times) {
            const accepted = await limiter.shouldAccept('u', 's', t);
            if (accepted) {
              if (lastAccepted !== null) {
                expect(t - lastAccepted).toBeGreaterThanOrEqual(INTERVAL_MS);
              }
              lastAccepted = t;
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
