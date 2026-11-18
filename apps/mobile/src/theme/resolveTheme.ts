/**
 * resolveTheme.ts — the pure `(mode, osScheme) → resolvedTheme` function.
 *
 * `mode` (the user's chosen, persisted value) is distinct from `resolvedTheme` (what renders).
 * SYSTEM is never returned — it resolves to the OS scheme, defaulting to DARK when the scheme is
 * unavailable (`null`). Pure and total over its input space.
 */

import { ResolvedTheme, ThemeMode } from './tokens';

/** The OS color scheme as reported by React Native's `useColorScheme()`. */
export type OsColorScheme = 'light' | 'dark' | null | undefined;

/**
 * Resolve the theme that should render.
 *  - DARK / LIGHT modes resolve to themselves.
 *  - SYSTEM resolves to LIGHT when the OS scheme is 'light', otherwise DARK (including a null/unset
 *    scheme — DARK is the brand default).
 */
export function resolve(mode: ThemeMode, osScheme: OsColorScheme): ResolvedTheme {
  if (mode === ThemeMode.LIGHT) {
    return ResolvedTheme.LIGHT;
  }
  if (mode === ThemeMode.DARK) {
    return ResolvedTheme.DARK;
  }
  // SYSTEM
  return osScheme === 'light' ? ResolvedTheme.LIGHT : ResolvedTheme.DARK;
}
