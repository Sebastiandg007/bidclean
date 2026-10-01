/**
 * ThemeContext.ts — the React context carrying the resolved theme value.
 *
 * The default context value is the DARK theme (the brand default). This is deliberate and
 * consistent with the whole spec's DARK-fallback invariant: a consumer used outside a
 * `ThemeProvider` (e.g. an isolated unit test rendering a screen directly) safely receives DARK
 * tokens rather than crashing. Inside the app, the single root `ThemeProvider` always supplies the
 * resolved value, so the default is never what real screens see.
 */

import { createContext } from 'react';

import { THEMES } from './themes';
import { ResolvedTheme, ThemeMode, type SemanticTokens } from './tokens';

export interface ThemeContextValue {
  /** Resolved semantic tokens for the active `resolvedTheme`. */
  theme: SemanticTokens;
  /** The user's chosen mode (DARK | LIGHT | SYSTEM). */
  mode: ThemeMode;
  /** What is actually rendering (DARK | LIGHT). */
  resolvedTheme: ResolvedTheme;
  /** Persist a new mode and re-render the app; a no-op default outside a provider. */
  setMode: (next: ThemeMode) => void;
}

/** DARK-default context value (safe fallback outside a provider). */
export const DEFAULT_CONTEXT_VALUE: ThemeContextValue = {
  theme: THEMES[ResolvedTheme.DARK],
  mode: ThemeMode.DARK,
  resolvedTheme: ResolvedTheme.DARK,
  setMode: () => undefined,
};

export const ThemeContext = createContext<ThemeContextValue>(DEFAULT_CONTEXT_VALUE);
