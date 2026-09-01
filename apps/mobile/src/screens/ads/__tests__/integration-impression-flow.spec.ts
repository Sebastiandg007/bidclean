/**
 * Integration test — paid-impression flow from provider event to the revenue tracker.
 *
 * Feature: revenuecat-ads
 * Validates: Requirements 3.1, 3.5 / Properties P4, P5, P14.
 *
 * Two layers are exercised:
 *   (1) `useAds.reportImpression` delegating to the module-level default tracker. Because that
 *       tracker is created at module load, we mock `../ad-revenue-tracker` with a spy DEFINED
 *       INSIDE the factory (avoids TDZ) and retrieved via `jest.requireMock` — the same pattern
 *       used by `useAds.spec.ts`.
 *   (2) The REAL `createAdRevenueTracker` wired to an in-memory KeyValueStore + a spy sink, to
 *       prove event-id dedup (one eventId -> at most one report) and best-effort non-throwing
 *       behavior on a failing sink.
 */

// ─── Mock the module-level default tracker (spy defined inside the factory: no TDZ) ───

jest.mock('../ad-revenue-tracker', () => {
  const report = jest.fn();
  const actual: typeof import('../ad-revenue-tracker') =
    jest.requireActual('../ad-revenue-tracker');
  return {
    ...actual,
    __report: report,
    createDefaultAdRevenueTracker: () => ({
      report,
      getDiagnostics: () => ({
        reportedCount: 0,
        duplicateCount: 0,
        lastReportedAtMs: null,
      }),
    }),
  };
});

import {
  createAdRevenueTracker,
  type AdRevenueSink,
  type KeyValueStore,
} from '../ad-revenue-tracker';
import { buildSyntheticImpression } from '../providers/mock.provider';
import { RADAR_AD_FORMAT } from '../ads.constants';
import type { PaidImpression } from '../ads.types';
import { useAdsStore } from '../useAds';

// Retrieve the hoisted report spy from the mocked default tracker.
const { __report: mockReport } = jest.requireMock('../ad-revenue-tracker') as {
  __report: jest.Mock;
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** An in-memory KeyValueStore standing in for SecureStore (real dedup ring persistence). */
function inMemoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (key: string): Promise<string | null> =>
      Promise.resolve(map.get(key) ?? null),
    setItem: (key: string, value: string): Promise<void> => {
      map.set(key, value);
      return Promise.resolve();
    },
  };
}

/** A configured sink whose `trackAdImpression` is a spy. */
function configuredSink(track: jest.Mock<Promise<void>, [PaidImpression]>): AdRevenueSink {
  return {
    isConfigured: () => true,
    trackAdImpression: track,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useAdsStore.getState().reset();
});

// ─── Layer 1: useAds.reportImpression -> default tracker ─────────────────────────

describe('useAds.reportImpression delegates to the tracker (P4)', () => {
  it('forwards a MockAdProvider synthetic paid impression and never throws', () => {
    const impression = buildSyntheticImpression('evt-flow-1', { format: RADAR_AD_FORMAT });

    expect(() => useAdsStore.getState().reportImpression(impression)).not.toThrow();
    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(mockReport).toHaveBeenCalledWith(impression);
  });
});

// ─── Layer 2: real tracker dedup + best-effort ───────────────────────────────────

describe('createAdRevenueTracker dedup and resilience (P5, P14)', () => {
  it('reports a duplicate eventId only once', async () => {
    const track = jest.fn<Promise<void>, [PaidImpression]>().mockResolvedValue(undefined);
    const tracker = createAdRevenueTracker(configuredSink(track), inMemoryStore());
    const impression = buildSyntheticImpression('evt-dup', { format: RADAR_AD_FORMAT });

    await tracker.report(impression);
    await tracker.report(impression);

    expect(track).toHaveBeenCalledTimes(1);
    const diagnostics = tracker.getDiagnostics();
    expect(diagnostics.reportedCount).toBe(1);
    expect(diagnostics.duplicateCount).toBe(1);
  });

  it('reports distinct eventIds independently', async () => {
    const track = jest.fn<Promise<void>, [PaidImpression]>().mockResolvedValue(undefined);
    const tracker = createAdRevenueTracker(configuredSink(track), inMemoryStore());

    await tracker.report(buildSyntheticImpression('evt-a', { format: RADAR_AD_FORMAT }));
    await tracker.report(buildSyntheticImpression('evt-b', { format: RADAR_AD_FORMAT }));

    expect(track).toHaveBeenCalledTimes(2);
    expect(tracker.getDiagnostics().reportedCount).toBe(2);
  });

  it('never throws out of report when the sink fails (best-effort, P4)', async () => {
    const track = jest
      .fn<Promise<void>, [PaidImpression]>()
      .mockRejectedValue(new Error('revenuecat down'));
    const tracker = createAdRevenueTracker(configuredSink(track), inMemoryStore());
    const impression = buildSyntheticImpression('evt-fail', { format: RADAR_AD_FORMAT });

    await expect(tracker.report(impression)).resolves.toBeUndefined();
    expect(track).toHaveBeenCalledTimes(1);
  });
});
