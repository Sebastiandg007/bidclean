/**
 * theme.constants.ts — named theme policy constants (no scattered literals).
 *
 * These are the tunables the theming backbone reads: the first-run/fallback mode, the persisted
 * preference key and its version, and the bootstrap safety timeout. Changing the default theme is a
 * one-line edit here (never a scattered literal across the app).
 */

import { ThemeMode } from './tokens';

/**
 * First-run and fallback mode. DARK is the brand default; switch the whole app's default to SYSTEM
 * by changing this single constant.
 */
export const DEFAULT_MODE: ThemeMode = ThemeMode.DARK;

/** `expo-secure-store` key under which the versioned preference `{ version, mode }` is stored. */
export const PREFERENCE_STORAGE_KEY = 'bidclean.theme.preference';

/** Version stamped into the persisted `{ version, mode }` shape so the format can migrate. */
export const PREFERENCE_VERSION = 1;

/**
 * Bootstrap safety budget. If reading the persisted preference has not completed within this many
 * milliseconds (e.g. a hung SecureStore SDK whose promise never settles), the store falls back to
 * `DEFAULT_MODE` and marks itself loaded so the splash gate can never hang forever. Named policy —
 * not user-configurable.
 */
export const THEME_BOOTSTRAP_TIMEOUT_MS = 2000;
