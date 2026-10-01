/**
 * Property-based test for preference load robustness — Property 4.
 *
 * Library: fast-check (≥100 iterations). One test per property.
 *
 * Covers the pure parse over arbitrary payloads (valid/missing/malformed/non-object/unknown
 * mode/wrong version) plus the async `load()` termination guarantees (throwing read → fallback,
 * never-settling read → terminates via THEME_BOOTSTRAP_TIMEOUT_MS), all yielding a valid ThemeMode.
 */

import * as fc from 'fast-check';

import { parseStoredPreference, useThemeStore } from '../useThemeStore';
import { DEFAULT_MODE, PREFERENCE_VERSION, THEME_BOOTSTRAP_TIMEOUT_MS } from '../theme.constants';
import { ThemeMode } from '../tokens';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}));

const SecureStore = require('expo-secure-store') as {
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
};

const VALID_MODES: ThemeMode[] = [ThemeMode.DARK, ThemeMode.LIGHT, ThemeMode.SYSTEM];

function resetStore(): void {
  useThemeStore.setState({ mode: DEFAULT_MODE, isLoaded: false, writeSeq: 0 });
}

describe('preference load robustness — Property 4', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetStore();
  });

  // Feature: dark-light-theme, Property 4: Preference load robustness (safe default, never throws)
  it('P4: parse returns a valid ThemeMode for any payload; stored mode iff well-formed+supported', () => {
    // Arbitrary stored payloads: valid current-version prefs, missing/null, malformed JSON,
    // non-object JSON, unknown mode, wrong/absent version.
    const validArb = fc
      .constantFrom(...VALID_MODES)
      .map((mode) => ({ raw: JSON.stringify({ version: PREFERENCE_VERSION, mode }), expected: mode }));

    const nullArb = fc.constant({ raw: null, expected: DEFAULT_MODE });

    const malformedArb = fc
      .constantFrom('not json', '{unclosed', '', '   ', '[1,2,3', '{"version":')
      .map((raw) => ({ raw, expected: DEFAULT_MODE }));

    const nonObjectArb = fc
      .constantFrom(JSON.stringify(42), JSON.stringify('x'), JSON.stringify([1, 2]), JSON.stringify(null))
      .map((raw) => ({ raw, expected: DEFAULT_MODE }));

    const unknownModeArb = fc
      .constantFrom('PURPLE', 'dark', 'system_v2', '')
      .map((mode) => ({ raw: JSON.stringify({ version: PREFERENCE_VERSION, mode }), expected: DEFAULT_MODE }));

    const wrongVersionArb = fc
      .record({ version: fc.integer({ min: -5, max: 99 }), mode: fc.constantFrom(...VALID_MODES) })
      .filter((r) => r.version !== PREFERENCE_VERSION)
      .map((r) => ({ raw: JSON.stringify(r), expected: DEFAULT_MODE }));

    const absentVersionArb = fc
      .constantFrom(...VALID_MODES)
      .map((mode) => ({ raw: JSON.stringify({ mode }), expected: DEFAULT_MODE }));

    const payloadArb = fc.oneof(
      validArb,
      nullArb,
      malformedArb,
      nonObjectArb,
      unknownModeArb,
      wrongVersionArb,
      absentVersionArb,
    );

    fc.assert(
      fc.property(payloadArb, ({ raw, expected }) => {
        let result: ThemeMode | undefined;
        expect(() => {
          result = parseStoredPreference(raw);
        }).not.toThrow();
        expect(VALID_MODES).toContain(result);
        expect(result).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('P4: a throwing SecureStore read falls back to DARK and marks loaded (never throws)', async () => {
    SecureStore.getItemAsync.mockRejectedValue(new Error('unavailable'));

    await expect(useThemeStore.getState().load()).resolves.toBeUndefined();

    expect(useThemeStore.getState().mode).toBe(DEFAULT_MODE);
    expect(useThemeStore.getState().isLoaded).toBe(true);
  });

  it('P4: a never-settling read terminates via the bootstrap timeout to DARK + isLoaded', async () => {
    jest.useFakeTimers();
    // A promise that never resolves — models a hung SecureStore SDK.
    SecureStore.getItemAsync.mockReturnValue(new Promise<string | null>(() => undefined));

    const loadPromise = useThemeStore.getState().load();
    jest.advanceTimersByTime(THEME_BOOTSTRAP_TIMEOUT_MS + 10);
    await loadPromise;

    expect(useThemeStore.getState().mode).toBe(DEFAULT_MODE);
    expect(useThemeStore.getState().isLoaded).toBe(true);
    jest.useRealTimers();
  });
});
