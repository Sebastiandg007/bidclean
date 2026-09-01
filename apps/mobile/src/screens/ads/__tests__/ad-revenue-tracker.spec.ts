/**
 * Unit tests for AdRevenueTracker.
 *
 * Validates: Requirements 3.3, 3.4, 3.5, 3.6 / Properties P4, P5, P10, P14. Collaborators are
 * injected (an in-memory KeyValueStore and a spyable AdRevenueSink), so no native SDK is needed.
 */

import {
  createAdRevenueTracker,
  type AdRevenueSink,
  type KeyValueStore,
} from '../ad-revenue-tracker';
import { AdFormat, type PaidImpression } from '../ads.types';

// ─── Test doubles ──────────────────────────────────────────────────────────────

function makeImpression(overrides: Partial<PaidImpression> = {}): PaidImpression {
  return {
    eventId: 'evt-1',
    revenueMicros: 1500,
    currency: 'USD',
    network: 'admob',
    adUnitId: 'ca-app-pub-test/banner',
    format: AdFormat.BANNER,
    occurredAtMs: 1_725_000_000_000,
    ...overrides,
  };
}

/** In-memory KeyValueStore; a fresh instance simulates a new relaunch when reused with same map. */
function makeStore(backing: Map<string, string> = new Map()): KeyValueStore {
  return {
    getItem: async (key) => backing.get(key) ?? null,
    setItem: async (key, value) => {
      backing.set(key, value);
    },
  };
}

function makeSink(configured = true): AdRevenueSink & { calls: PaidImpression[] } {
  const calls: PaidImpression[] = [];
  return {
    calls,
    isConfigured: () => configured,
    trackAdImpression: async (impression) => {
      calls.push(impression);
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AdRevenueTracker.report', () => {
  it('forwards a paid impression to the RevenueCat sink', async () => {
    const sink = makeSink();
    const tracker = createAdRevenueTracker(sink, makeStore());
    await tracker.report(makeImpression());
    expect(sink.calls).toHaveLength(1);
    expect(sink.calls[0]?.eventId).toBe('evt-1');
  });

  it('reports each eventId at most once across retries (P5/P14)', async () => {
    const sink = makeSink();
    const tracker = createAdRevenueTracker(sink, makeStore());
    await tracker.report(makeImpression({ eventId: 'evt-dup' }));
    await tracker.report(makeImpression({ eventId: 'evt-dup' }));
    await tracker.report(makeImpression({ eventId: 'evt-dup' }));
    expect(sink.calls).toHaveLength(1);
    expect(tracker.getDiagnostics().duplicateCount).toBe(2);
  });

  it('dedups across a simulated relaunch via the persisted ring', async () => {
    const backing = new Map<string, string>();
    const firstSink = makeSink();
    const first = createAdRevenueTracker(firstSink, makeStore(backing));
    await first.report(makeImpression({ eventId: 'evt-persist' }));
    expect(firstSink.calls).toHaveLength(1);

    // New tracker instance + fresh in-memory set, but same persisted backing = a relaunch.
    const secondSink = makeSink();
    const second = createAdRevenueTracker(secondSink, makeStore(backing));
    await second.report(makeImpression({ eventId: 'evt-persist' }));
    expect(secondSink.calls).toHaveLength(0);
  });

  it('skips gracefully when RevenueCat is not configured (Req 3.6)', async () => {
    const sink = makeSink(false);
    const tracker = createAdRevenueTracker(sink, makeStore());
    await tracker.report(makeImpression());
    expect(sink.calls).toHaveLength(0);
  });

  it('swallows a sink failure and never throws (Req 3.3 / P4)', async () => {
    const failingSink: AdRevenueSink = {
      isConfigured: () => true,
      trackAdImpression: async () => {
        throw new Error('network down');
      },
    };
    const tracker = createAdRevenueTracker(failingSink, makeStore());
    await expect(tracker.report(makeImpression())).resolves.toBeUndefined();
  });

  it('forwards only ad-event metadata (no PII fields present) — P10', async () => {
    const sink = makeSink();
    const tracker = createAdRevenueTracker(sink, makeStore());
    await tracker.report(makeImpression());
    const reported = sink.calls[0];
    expect(Object.keys(reported ?? {}).sort()).toEqual(
      [
        'adUnitId',
        'currency',
        'eventId',
        'format',
        'network',
        'occurredAtMs',
        'revenueMicros',
      ].sort(),
    );
  });
});
