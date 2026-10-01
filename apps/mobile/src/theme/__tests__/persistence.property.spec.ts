/**
 * Property-based test for preference persistence — Property 5.
 *
 * Library: fast-check (≥100 iterations). One test per property.
 *
 * Round-trip: setMode(m) then reload yields m with shape { version, mode }. Last-write-wins: for
 * any finite mode sequence issued faster than writes settle, the final persisted mode equals the
 * last one — an older in-flight write never overwrites a newer one.
 */

import * as fc from 'fast-check';

import { parseStoredPreference, useThemeStore } from '../useThemeStore';
import { DEFAULT_MODE, PREFERENCE_STORAGE_KEY, PREFERENCE_VERSION } from '../theme.constants';
import { ThemeMode } from '../tokens';

// In-memory secure-store fake with deferred, controllable write completion so writes can settle
// out of order.
interface Deferred {
  key: string;
  value: string;
  resolve: () => void;
}

const mockStore = new Map<string, string>();
const pendingWrites: Deferred[] = [];

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockStore.get(key) ?? null)),
  setItemAsync: jest.fn(
    (key: string, value: string) =>
      new Promise<void>((resolve) => {
        pendingWrites.push({
          key,
          value,
          resolve: () => {
            mockStore.set(key, value);
            resolve();
          },
        });
      }),
  ),
}));

const VALID_MODES: ThemeMode[] = [ThemeMode.DARK, ThemeMode.LIGHT, ThemeMode.SYSTEM];

function resetAll(): void {
  mockStore.clear();
  pendingWrites.length = 0;
  useThemeStore.setState({ mode: DEFAULT_MODE, isLoaded: false, writeSeq: 0 });
}

describe('preference persistence — Property 5', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetAll();
  });

  // Feature: dark-light-theme, Property 5: Preference persistence round-trip and last-write-wins
  it('P5: setMode(m) then reload yields m with shape { version, mode } (round-trip identity)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...VALID_MODES), async (mode) => {
        resetAll();
        // Auto-complete writes as they arrive for the round-trip case.
        const settleLoop = setInterval(() => pendingWrites.shift()?.resolve(), 0);
        await useThemeStore.getState().setMode(mode);
        clearInterval(settleLoop);
        // Drain any straggler write.
        while (pendingWrites.length > 0) {
          pendingWrites.shift()?.resolve();
        }

        const raw = mockStore.get(PREFERENCE_STORAGE_KEY) ?? null;
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw as string) as { version: number; mode: ThemeMode };
        expect(parsed).toEqual({ version: PREFERENCE_VERSION, mode });
        expect(parseStoredPreference(raw)).toBe(mode);
      }),
      { numRuns: 100 },
    );
  });

  it('P5: for any sequence, the final persisted mode equals the last (last-write-wins)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(...VALID_MODES), { minLength: 1, maxLength: 6 }),
        async (sequence) => {
          resetAll();

          // A background loop settles pending writes in REVERSE arrival order as the serialized
          // writer chain enqueues them, stressing out-of-order completion. The writer coalesces to
          // the latest requested mode, so the final settled value must be the last mode regardless.
          const settleLoop = setInterval(() => pendingWrites.pop()?.resolve(), 0);

          // Issue the whole sequence, then wait for every setMode's persist to settle.
          const promises = sequence.map((m) => useThemeStore.getState().setMode(m));
          await Promise.all(promises);
          clearInterval(settleLoop);
          while (pendingWrites.length > 0) {
            pendingWrites.pop()?.resolve();
          }

          const last = sequence[sequence.length - 1];
          expect(parseStoredPreference(mockStore.get(PREFERENCE_STORAGE_KEY) ?? null)).toBe(last);
          // In-memory mode always reflects the latest requested mode immediately.
          expect(useThemeStore.getState().mode).toBe(last);
        },
      ),
      { numRuns: 100 },
    );
  });
});
