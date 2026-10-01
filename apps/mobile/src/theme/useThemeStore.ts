/**
 * useThemeStore.ts — Zustand store owning the persisted theme preference and mode transitions.
 *
 * Responsibilities (only the *stateful* part of theming — the provider distributes the derived
 * theme value via context):
 *   - `load()`  reads `{ version, mode }` from expo-secure-store, validates it, and folds EVERY
 *               failure mode (missing / null / malformed JSON / non-object / unknown mode /
 *               absent-unknown version / thrown read / never-settling read) to `DEFAULT_MODE`
 *               (DARK) with `isLoaded = true`. It races the read against THEME_BOOTSTRAP_TIMEOUT_MS
 *               so a hung SecureStore promise still terminates. Never throws, never blocks forever.
 *   - `setMode(next)` updates the in-memory mode immediately, then persists it on a serialized
 *               single-writer queue stamped by a monotonic `writeSeq` (last-write-wins): a
 *               superseded in-flight write is discarded so a stale mode can never overwrite a newer
 *               one. A write failure still applies the mode for the session and is logged.
 *
 * On-device only — no network / profile write ever occurs.
 */

import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

import {
  DEFAULT_MODE,
  PREFERENCE_STORAGE_KEY,
  PREFERENCE_VERSION,
  THEME_BOOTSTRAP_TIMEOUT_MS,
} from './theme.constants';
import { ThemeMode } from './tokens';

/** The persisted preference shape (on-device, versioned). */
export interface StoredPreference {
  version: number;
  mode: ThemeMode;
}

export interface ThemeStoreState {
  /** The current chosen mode (DARK until the persisted value is loaded). */
  mode: ThemeMode;
  /** True once persistence has been read or safely fallen back (always eventually true). */
  isLoaded: boolean;
  /** Monotonic counter stamping each setMode write for last-write-wins. */
  writeSeq: number;
  /** Read + validate the persisted preference; fall back to DARK on any failure or timeout. */
  load: () => Promise<void>;
  /** Update + persist the mode (serialized, last-write-wins). */
  setMode: (next: ThemeMode) => Promise<void>;
}

/** A sentinel used to detect a never-settling read via the timeout race. */
const TIMED_OUT = Symbol('theme-bootstrap-timeout');

/** True when `value` is one of the known `ThemeMode` enum values. */
function isValidMode(value: unknown): value is ThemeMode {
  return value === ThemeMode.DARK || value === ThemeMode.LIGHT || value === ThemeMode.SYSTEM;
}

/** Parse a stored payload into a valid mode, or `DEFAULT_MODE` for any malformed/unsupported shape. */
export function parseStoredPreference(raw: string | null): ThemeMode {
  if (raw === null) {
    return DEFAULT_MODE;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return DEFAULT_MODE;
    }
    const candidate = parsed as Partial<StoredPreference>;
    if (candidate.version !== PREFERENCE_VERSION || !isValidMode(candidate.mode)) {
      return DEFAULT_MODE;
    }
    return candidate.mode;
  } catch {
    return DEFAULT_MODE;
  }
}

/** Resolve to the persisted mode, or `DEFAULT_MODE` if the read throws or exceeds the timeout. */
async function readModeWithTimeout(): Promise<ThemeMode> {
  const read = SecureStore.getItemAsync(PREFERENCE_STORAGE_KEY)
    .then(parseStoredPreference)
    .catch(() => DEFAULT_MODE);

  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    setTimeout(() => resolve(TIMED_OUT), THEME_BOOTSTRAP_TIMEOUT_MS);
  });

  const result = await Promise.race([read, timeout]);
  return result === TIMED_OUT ? DEFAULT_MODE : result;
}

/** Write the preference to storage; a failure is logged (never swallowed silently), never throws. */
async function writePreference(mode: ThemeMode): Promise<void> {
  try {
    const payload: StoredPreference = { version: PREFERENCE_VERSION, mode };
    await SecureStore.setItemAsync(PREFERENCE_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('[theme] Failed to persist theme preference:', error);
  }
}

/**
 * Single-writer serialization for last-write-wins persistence.
 *
 * `enqueuePersist(mode, seq)` records the latest requested `(mode, seq)` and ensures exactly one
 * writer runs at a time. Because the writer always reads the *latest* pending mode when its turn
 * comes, and writes are strictly serialized, the final settled value in storage is always the mode
 * of the highest `writeSeq` — an older in-flight request can never overwrite a newer one.
 */
let latestPending: { mode: ThemeMode; seq: number } | null = null;
let writerChain: Promise<void> = Promise.resolve();

function enqueuePersist(mode: ThemeMode, seq: number): Promise<void> {
  latestPending = { mode, seq };
  writerChain = writerChain.then(async () => {
    const pending = latestPending;
    if (pending === null || pending.seq !== seq) {
      // A newer request has superseded this one; it will (or already did) write the newer value.
      return;
    }
    latestPending = null;
    await writePreference(pending.mode);
  });
  return writerChain;
}

export const useThemeStore = create<ThemeStoreState>((set, get) => ({
  mode: DEFAULT_MODE,
  isLoaded: false,
  writeSeq: 0,

  load: async () => {
    const mode = await readModeWithTimeout();
    // A late read after a user has already chosen must not clobber their choice: only adopt the
    // loaded mode if no setMode has run yet (writeSeq still 0).
    set((state) => (state.writeSeq === 0 ? { mode, isLoaded: true } : { isLoaded: true }));
  },

  setMode: async (next: ThemeMode) => {
    const seq = get().writeSeq + 1;
    set({ mode: next, writeSeq: seq });
    // Last-write-wins: the serialized writer always persists the latest requested mode; a
    // superseded in-flight request is coalesced away, so a stale mode can never win.
    await enqueuePersist(next, seq);
  },
}));
