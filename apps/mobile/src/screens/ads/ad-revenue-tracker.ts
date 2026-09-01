/**
 * ad-revenue-tracker — Reports paid impressions (ILRD) to RevenueCat's AdTracker.
 *
 * Kept SEPARATE from the AdProvider and the AdSlot so rendering and revenue tracking are
 * independently testable (Req 2.6). It forwards ONLY paid, revenue-bearing impressions (Req 3.1),
 * attributed by ad-event metadata only — never PII (Req 3.4 / P10). Reporting is BEST-EFFORT and
 * NON-BLOCKING: any failure is swallowed and never breaks rendering or the radar (Req 3.3 / P4).
 *
 * Duplicate protection: an eventId dedup ring (in-memory + a bounded persisted set) so a retry,
 * remount, or relaunch after a paid impression does not re-report (Req 3.5 / P5 / P14). This is
 * best-effort duplicate REDUCTION, not a remote exactly-once guarantee.
 *
 * Collaborators (a RevenueCat sink + a key/value store) are injected so the tracker is pure and
 * testable; the default wiring binds SecureStore + the RevenueCat SDK's ad-tracking surface.
 */

import {
  RC_ANDROID_API_KEY,
  RC_IOS_API_KEY,
} from '../subscriptions/subscriptions.constants';
import type { PaidImpression } from './ads.types';

// ─── Collaborator seams (injected; default wiring at the bottom) ──────────────

/** The RevenueCat ad-revenue sink. Returns void; may reject (handled as best-effort). */
export interface AdRevenueSink {
  /** Whether RevenueCat is configured to receive ad revenue in this environment (Req 3.6). */
  isConfigured(): boolean;
  /** Forward a single paid impression's ILRD to RevenueCat. */
  trackAdImpression(impression: PaidImpression): Promise<void>;
}

/** A minimal async key/value store used to persist the dedup ring across relaunches. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Optional non-PII diagnostics for observability (never blocks reporting). */
export interface AdRevenueTrackerDiagnostics {
  reportedCount: number;
  duplicateCount: number;
  lastReportedAtMs: number | null;
}

export interface AdRevenueTracker {
  /** Report a paid impression (deduped, best-effort, non-blocking). */
  report(impression: PaidImpression): Promise<void>;
  /** Read the current non-PII diagnostics snapshot. */
  getDiagnostics(): AdRevenueTrackerDiagnostics;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** SecureStore key holding the bounded persisted dedup ring. */
const DEDUP_STORE_KEY = 'bidclean_ad_event_ids';

/** Max eventIds retained in the persisted ring (bounded to avoid unbounded growth). */
const DEDUP_RING_CAPACITY = 200;

// ─── Implementation ────────────────────────────────────────────────────────────

class AdRevenueTrackerImpl implements AdRevenueTracker {
  private readonly seenInMemory = new Set<string>();
  private hydrated = false;
  private readonly diagnostics: AdRevenueTrackerDiagnostics = {
    reportedCount: 0,
    duplicateCount: 0,
    lastReportedAtMs: null,
  };

  constructor(
    private readonly sink: AdRevenueSink,
    private readonly store: KeyValueStore,
  ) {}

  async report(impression: PaidImpression): Promise<void> {
    try {
      if (!this.sink.isConfigured()) {
        return; // Skip gracefully when RevenueCat is not configured (Req 3.6).
      }
      await this.hydrateOnce();
      if (this.seenInMemory.has(impression.eventId)) {
        this.diagnostics.duplicateCount += 1;
        return; // Duplicate: at most one report per eventId (P5 / P14).
      }
      this.seenInMemory.add(impression.eventId);
      await this.persistSeen(impression.eventId);
      await this.sink.trackAdImpression(impression);
      this.diagnostics.reportedCount += 1;
      this.diagnostics.lastReportedAtMs = impression.occurredAtMs;
    } catch {
      // Best-effort: never surface a tracking failure to the UI (Req 3.3 / P4).
    }
  }

  getDiagnostics(): AdRevenueTrackerDiagnostics {
    return { ...this.diagnostics };
  }

  /** Load the persisted dedup ring once (relaunch protection). */
  private async hydrateOnce(): Promise<void> {
    if (this.hydrated) {
      return;
    }
    this.hydrated = true;
    const raw = await this.store.getItem(DEDUP_STORE_KEY);
    if (raw === null) {
      return;
    }
    for (const id of parseRing(raw)) {
      this.seenInMemory.add(id);
    }
  }

  /** Append an eventId to the bounded persisted ring (best-effort). */
  private async persistSeen(eventId: string): Promise<void> {
    const bounded = boundRing([...this.seenInMemory], eventId);
    await this.store.setItem(DEDUP_STORE_KEY, JSON.stringify(bounded));
  }
}

// ─── Ring helpers (pure) ───────────────────────────────────────────────────────

/** Parse the persisted ring, tolerating any corrupt value by returning an empty ring. */
function parseRing(raw: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

/** Keep the most recent ids up to capacity, ensuring the newest id is retained. */
function boundRing(ids: readonly string[], newest: string): readonly string[] {
  const deduped = Array.from(new Set([...ids, newest]));
  if (deduped.length <= DEDUP_RING_CAPACITY) {
    return deduped;
  }
  return deduped.slice(deduped.length - DEDUP_RING_CAPACITY);
}

// ─── Factory & default wiring ────────────────────────────────────────────────

/** Construct a tracker from explicit collaborators (used in tests). */
export function createAdRevenueTracker(
  sink: AdRevenueSink,
  store: KeyValueStore,
): AdRevenueTracker {
  return new AdRevenueTrackerImpl(sink, store);
}

/** SecureStore-backed key/value store for the persisted dedup ring (default wiring). */
const secureKeyValueStore: KeyValueStore = {
  async getItem(key) {
    const SecureStore = await import('expo-secure-store');
    return SecureStore.getItemAsync(key);
  },
  async setItem(key, value) {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.setItemAsync(key, value);
  },
};

/**
 * Default RevenueCat ad-revenue sink. `isConfigured` reflects whether a platform public SDK key
 * is present (mirrors how subscriptions decide configuration); `trackAdImpression` forwards the
 * ILRD to the RevenueCat SDK's ad-tracking surface behind a capability guard so a missing SDK
 * method degrades to a no-op rather than throwing.
 */
const revenueCatAdSink: AdRevenueSink = {
  isConfigured() {
    return RC_IOS_API_KEY !== '' || RC_ANDROID_API_KEY !== '';
  },
  async trackAdImpression(impression) {
    const Purchases = (await import('react-native-purchases')).default as unknown as {
      trackAdImpression?: (payload: PaidImpression) => Promise<void> | void;
    };
    if (typeof Purchases.trackAdImpression === 'function') {
      await Purchases.trackAdImpression(impression);
    }
  },
};

/** The default, production-wired tracker (RevenueCat sink + SecureStore ring). */
export function createDefaultAdRevenueTracker(): AdRevenueTracker {
  return new AdRevenueTrackerImpl(revenueCatAdSink, secureKeyValueStore);
}
