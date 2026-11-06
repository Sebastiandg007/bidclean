/**
 * dark.theme.ts — the DEFAULT and reference theme.
 *
 * Semantic → primitive mapping ONLY. Contains zero hex literals (all values reference `palette.*`).
 * Typed as `SemanticTokens` so the full shape is compile-enforced.
 */

import { palette } from './primitives';
import type { SemanticTokens } from './tokens';

export const darkTheme: SemanticTokens = {
  background: palette.obsidian,
  surface: palette.surfaceDark,
  surfaceElevated: palette.surfaceElevatedDark,
  textPrimary: palette.white,
  textSecondary: palette.textSecondaryDark,
  textMuted: palette.textMutedDark,
  accent: palette.mint, // interactive/active emphasis only — never a surface
  onAccent: palette.onAccent, // dark text/icon on mint
  border: palette.borderDark,
  divider: palette.dividerDark,
  danger: palette.danger,
  success: palette.success,
  warning: palette.warning,
  overlay: palette.overlayDark,
  shadow: palette.shadow,
};
