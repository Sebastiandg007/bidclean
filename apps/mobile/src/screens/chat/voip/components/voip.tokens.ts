/**
 * voip.tokens — shared BidClean dark design tokens for the call UI (Spec 15).
 *
 * Kept in one place so every call surface (sheet, in-call screen, header affordance, log entry)
 * uses the same palette/spacing. Mirrors the tokens used across the chat screens.
 */

export const VOIP_COLORS = {
  background: '#0B0C10',
  card: '#1F2833',
  accent: '#00F5D4',
  textPrimary: '#FFFFFF',
  textMuted: 'rgba(255, 255, 255, 0.5)',
  danger: '#FF6B6B',
  overlay: 'rgba(11, 12, 16, 0.92)',
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
