/**
 * useThemedStyles.ts — the migration primitive that replaces per-file `const COLORS` +
 * `StyleSheet.create`.
 *
 * `makeStyles(factory)` takes a factory `(theme) => styles` and returns a hook. The hook reads the
 * active theme via `useTheme()` and memoizes the created `StyleSheet` per `resolvedTheme`, so a
 * mode change recomputes styles exactly once (and repeated renders in the same mode reuse the same
 * object). A screen therefore never holds a raw hex literal again — colors come from `theme.*`.
 *
 * Usage:
 *   const useStyles = makeStyles((theme) => ({ badge: { backgroundColor: theme.accent } }));
 *   // inside the component:
 *   const styles = useStyles();
 */

import { useMemo } from 'react';
import { StyleSheet } from 'react-native';

import { useTheme } from './useTheme';
import type { SemanticTokens } from './tokens';

type NamedStyles<T> = StyleSheet.NamedStyles<T>;

/**
 * Build a themed-styles hook from a factory. The returned hook memoizes the StyleSheet on the
 * current `resolvedTheme`.
 */
export function makeStyles<T extends NamedStyles<T>>(
  factory: (theme: SemanticTokens) => T,
): () => T {
  return function useStyles(): T {
    const { theme, resolvedTheme } = useTheme();
    // Recompute only when the resolved theme changes; the factory is a stable module-level fn and
    // `theme` is derived from `resolvedTheme`, so keying on `resolvedTheme` alone is correct.
    return useMemo(() => StyleSheet.create(factory(theme)), [resolvedTheme]);
  };
}
