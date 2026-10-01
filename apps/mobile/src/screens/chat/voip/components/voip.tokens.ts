/**
 * voip.tokens — shared BidClean dark design tokens for the call UI (Spec 15).
 *
 * Kept in one place so every call surface (sheet, in-call screen, header affordance, log entry)
 * uses the same palette/spacing. Mirrors the tokens used across the chat screens.
 */

import { palette } from '../../../../theme/primitives';

/**
 * The call UI is an immersive, always-dark surface (Spec 15), so these tokens map onto the dark
 * palette by reference — no raw hex lives here. Values are identical to the previous hardcoded
 * palette, preserving the dark call appearance.
 */
export const VOIP_COLORS = {
  background: palette.obsidian,
  card: palette.surfaceDark,
  accent: palette.mint,
  textPrimary: palette.white,
  textMuted: palette.whiteAlpha50,
  danger: palette.danger,
  overlay: palette.overlayCallDark,
} as const;

export const VOIP_SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const VOIP_FONT_SIZE = {
  caption: 12,
  body: 15,
  title: 20,
  duration: 40,
  icon: 22,
} as const;
