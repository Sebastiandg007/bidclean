/**
 * themes.ts — the resolved theme registry + shape-parity guard.
 *
 * `THEMES` maps each `ResolvedTheme` to its `SemanticTokens`. `assertTokenParity()` is a dev/CI
 * guard mirroring Property 1: it throws if the dark and light themes do not expose the identical
 * set of semantic keys (catching a dark-only or light-only token even outside the test file).
 */

import { darkTheme } from './dark.theme';
import { lightTheme } from './light.theme';
import { ResolvedTheme, type SemanticTokens } from './tokens';

export const THEMES: Record<ResolvedTheme, SemanticTokens> = {
  [ResolvedTheme.DARK]: darkTheme,
  [ResolvedTheme.LIGHT]: lightTheme,
};

/**
 * Throws if the two themes do not have the identical semantic-key set. A pure structural check —
 * no rendering, no side effects beyond the throw.
 */
export function assertTokenParity(): void {
  const darkKeys = Object.keys(darkTheme).sort();
  const lightKeys = Object.keys(lightTheme).sort();

  if (darkKeys.length !== lightKeys.length || darkKeys.some((key, i) => key !== lightKeys[i])) {
    throw new Error(
      `[theme] Token-shape parity violation: dark=[${darkKeys.join(', ')}] light=[${lightKeys.join(', ')}]`,
    );
  }
}
