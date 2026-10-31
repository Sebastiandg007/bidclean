/**
 * light.theme.ts — additive parity theme.
 *
 * Semantic → primitive mapping ONLY. Contains zero hex literals (all values reference `palette.*`).
 * Warm off-white background (never pure white), same mint accent reserved for interactive/active
 * emphasis. Typed as `SemanticTokens` so the full shape is compile-enforced and identical to dark.
 */

import { palette } from './primitives';
import type { SemanticTokens } from './tokens';

export const lightTheme: SemanticTokens = {
  background: palette.warmOffWhite, // warm, never pure white
  surface: palette.surfaceLight,
  surfaceElevated: palette.surfaceElevatedLight,
  textPrimary: palette.nearBlack,
  textSecondary: palette.textSecondaryLight,
  textMuted: palette.textMutedLight,
  accent: palette.mint, // same mint, still interactive/active only — never a surface
  onAccent: palette.onAccent, // dark text/icon on mint
  border: palette.borderLight,
  divider: palette.dividerLight,
  danger: palette.dangerLight,
  success: palette.successLight,
  warning: palette.warningLight,
  overlay: palette.overlayLight,
  shadow: palette.shadow,
};
