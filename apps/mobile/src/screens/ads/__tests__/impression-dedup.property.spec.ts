/**
 * Property-based tests for impression deduplication using fast-check.
 *
 * Properties 5 & 14: No double counting / impression uniqueness. For any
 * interleaved sequence of `report` calls over a small pool of eventIds (with
 * repeats), each DISTINCT eventId is forwarded to the RevenueCat sink AT MOST
 * ONCE — including across a simulated relaunch (a new tracker that hydrates from
 * the same persisted key/value backing).
 *
 * Validates: Requirement 3.5.
 * Library: fast-check (TypeScript). Minimum 100 iterations per property.
 */

import * as fc from 'fast-check';

import {
  createAdRevenueTracker,
  type AdRevenueSink,
  type KeyValueStore,
} from '../ad-revenue-tracker';
import { AdFormat, type PaidImpression } from '../ads.types';

// ─── In-memory collaborators ─────────────────────────────────────────────────

/** A key/value store backed by an injected Map so relaunches can share state. */
function createMemoryStore(backing: Map<string, string>): KeyValueStore {
  return {
    getItem: (key) => Promise.resolve(backing.get(key) ?? null),
    setItem: (key, value) => {
      backing.set(key, value);
      return Promise.resolve();
    },
  };
}

interface SpySink extends AdRevenueSink {
  readonly forwarded: string[];
}

/** A sink that records every eventId it is asked to forward. */
function createSpySink(): SpySink {
  const forwarded: string[] = [];
  return {
    forwarded,
    isConfigured: () => true,
    trackAdImpression: (impression) => {
      forwarded.push(impression.eventId);
      return Promise.resolve();
    },
  };
}

/** Build a paid impression for a given eventId (metadata is otherwise fixed). */
function impressionFor(eventId: string): PaidImpression {
  return {
    eventId,
    revenueMicros: 1_000,
    currency: 'USD',
    network: 'mock',
    adUnitId: 'mock/banner',
    format: AdFormat.BANNER,
    occurredAtMs: 0,
  };
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** A small, fixed pool so repeats are frequent within a generated sequence. */
const EVENT_ID_POOL = ['evt-a', 'evt-b', 'evt-c', 'evt-d', 'evt-e'] as const;

const eventIdArb = fc.constantFrom<string>(...EVENT_ID_POOL);
const sequenceArb = fc.array(eventIdArb, { minLength: 1, maxLength: 40 });

// ─── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

/** Report a whole sequence through one tracker, awaiting each call in order. */
async function reportSequence(
  sink: AdRevenueSink,
  store: KeyValueStore,
  sequence: readonly string[],
): Promise<void> {
  const tracker = createAdRevenueTracker(sink, store);
  for (const eventId of sequence) {
    await tracker.report(impressionFor(eventId));
  }
}

// ─── Property tests ──────────────────────────────────────────────────────────

describe('Impression Dedup — Property-Based Tests', () => {
  // Feature: revenuecat-ads, Properties 5 & 14: No double counting
  describe('Properties 5 & 14: Impression uniqueness (no double counting)', () => {
    /**
     * Validates: Requirement 3.5
     *
     * Within a single tracker session, each distinct eventId is forwarded at most
     * once, and every distinct eventId in the sequence is forwarded exactly once.
     */
    it('forwards each distinct eventId at most once within one session', async () => {
      await fc.assert(
        fc.asyncProperty(sequenceArb, async (sequence) => {
          const sink = createSpySink();
          const store = createMemoryStore(new Map<string, string>());

          await reportSequence(sink, store, sequence);

          const distinct = new Set(sequence);
          const forwardedSet = new Set(sink.forwarded);

          // No duplicates among forwarded ids.
          expect(sink.forwarded.length).toBe(forwardedSet.size);
          // Every distinct requested id was forwarded exactly once.
          expect(forwardedSet).toEqual(distinct);
        }),
        { numRuns: 200 },
      );
    });

    /**
     * Validates: Requirement 3.5
     *
     * Across a relaunch (a second tracker hydrating from the same persisted
     * backing Map), an eventId already reported before the relaunch is NOT
     * reported again — at most one forward per distinct eventId over the whole
     * lifetime.
     */
    it('does not re-forward across a relaunch sharing the same persisted store', async () => {
      await fc.assert(
        fc.asyncProperty(
          sequenceArb,
          sequenceArb,
          async (beforeRelaunch, afterRelaunch) => {
            const backing = new Map<string, string>();
            const store = createMemoryStore(backing);

            // First session forwards to its own sink.
            const sinkBefore = createSpySink();
            await reportSequence(sinkBefore, store, beforeRelaunch);

            // Relaunch: brand-new tracker + sink, same persisted backing.
            const sinkAfter = createSpySink();
            await reportSequence(sinkAfter, store, afterRelaunch);

            const forwardedBefore = new Set(sinkBefore.forwarded);
            const forwardedAfter = new Set(sinkAfter.forwarded);

            // Post-relaunch, nothing already forwarded pre-relaunch is forwarded again.
            for (const eventId of forwardedAfter) {
              expect(forwardedBefore.has(eventId)).toBe(false);
            }

            // Union across the whole lifetime is exactly the distinct ids seen,
            // and each was forwarded at most once (no double counting).
            const lifetimeForwarded = [...sinkBefore.forwarded, ...sinkAfter.forwarded];
            const lifetimeSet = new Set(lifetimeForwarded);
            expect(lifetimeForwarded.length).toBe(lifetimeSet.size);

            const distinctRequested = new Set([...beforeRelaunch, ...afterRelaunch]);
            expect(lifetimeSet).toEqual(distinctRequested);
          },
        ),
        { numRuns: 150 },
      );
    });
  });
});
