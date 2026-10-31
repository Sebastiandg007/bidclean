/**
 * tokens.ts — the semantic token SHAPE and the mode/theme enums.
 *
 * This file defines the *type contract* every theme must satisfy. It contains no color values
 * (those live only in `primitives.ts`); it declares:
 *
 *  - `ThemeMode`      — the user's persisted choice (DARK | LIGHT | SYSTEM).
 *  - `ResolvedTheme`  — what actually renders (DARK | LIGHT). There is NO SYSTEM here: SYSTEM is a
 *                       mode, never a theme.
 *  - `SemanticTokens` — the named color roles screens consume via `useTheme()`. Every theme MUST
 *                       provide every key (compile-enforced), so a screen can never reference a
 *                       token that is undefined in one mode, and a missing/misspelled token is a
 *                       compile error. No `any`.
 */

/** The user's persisted theme choice. */
export enum ThemeMode {
  DARK = 'DARK',
  LIGHT = 'LIGHT',
  SYSTEM = 'SYSTEM',
}

/** What actually renders. SYSTEM is a mode, not a theme — it never appears here. */
export enum ResolvedTheme {
  DARK = 'DARK',
  LIGHT = 'LIGHT',
}

/**
 * The semantic token shape. Every theme (dark & light) must provide every key with a defined,
 * non-empty color string. Screens consume these roles — never raw hex, never a primitive directly.
 */
export interface SemanticTokens {
  /** App-wide base background. */
  background: string;
  /** Card / container surface sitting on `background`. */
  surface: string;
  /** Raised surface (menus, elevated cards) sitting above `surface`. */
  surfaceElevated: string;
  /** Primary body/heading text. */
  textPrimary: string;
  /** Secondary text (subtitles, captions). */
  textSecondary: string;
  /** Muted text (hints, disabled, placeholders). */
  textMuted: string;
  /** Mint — interactive/active emphasis ONLY (CTAs, links, focus/selected). Never a surface. */
  accent: string;
  /** Text/icon color that sits on top of `accent`. */
  onAccent: string;
  /** Hairline borders around inputs/cards. */
  border: string;
  /** Divider lines between rows/sections. */
  divider: string;
  /** Destructive / error color. */
  danger: string;
  /** Positive / success color. */
  success: string;
  /** Caution / warning color (pending, in-progress, near-limit states). */
  warning: string;
  /** Scrim behind modals/sheets. */
  overlay: string;
  /** Elevation shadow color (opacity is applied at the use site). */
  shadow: string;
}
