/**
 * useTheme.ts — the app-wide hook for reading the resolved theme.
 *
 * Returns `{ theme, mode, resolvedTheme, setMode }`. Screens read `theme.*` for colors, the
 * appearance selector reads `mode` and calls `setMode`, and anything that needs "am I dark or
 * light right now?" reads `resolvedTheme`. Consumers MUST NOT import a raw palette/theme module for
 * values — color values come only through this hook (and `useThemedStyles`).
 *
 * Used outside a `ThemeProvider`, it returns the DARK-default context value (the spec's
 * DARK-fallback invariant) rather than throwing, so isolated component tests need no provider.
 */

import { useContext } from 'react';

import { ThemeContext, type ThemeContextValue } from './ThemeContext';

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
