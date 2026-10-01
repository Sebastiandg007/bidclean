/**
 * primitives.ts — the SINGLE physical home for raw color values.
 *
 * Every concrete color the app uses, for BOTH modes, is defined here as a named entry. This is the
 * only file in application source allowed to contain a `#RRGGBB` / `rgba(...)` literal (enforced by
 * the hex-guard). The theme files (`dark.theme.ts` / `light.theme.ts`) map semantic tokens onto
 * these names by reference only — they contain zero hex literals. Screens never import `palette`
 * for values; they consume semantic tokens via `useTheme()`.
 *
 * Values are chosen to satisfy WCAG 2.1 AA (verified by `contrast.ts` in tests) for the
 * text/essential-UI token pairs in both themes.
 */
export const palette = {
  // ── Brand seeds ────────────────────────────────────────────────────────────
  obsidian: '#0B0C10', // dark background (brand reference)
  surfaceDark: '#1F2833', // dark card/surface (brand reference)
  mint: '#00F5D4', // accent — interactive/active emphasis only (brand reference)
  white: '#FFFFFF', // dark primary text (brand reference)
  warmOffWhite: '#F5F2EB', // light background — warm, never pure white

  // ── Dark-mode literals ───────────────────────────────────────────────────────
  surfaceElevatedDark: '#252F3A',
  textSecondaryDark: '#C4CCD4',
  textMutedDark: '#939DA8',
  borderDark: '#2C3540',
  dividerDark: '#232B34',
  overlayDark: 'rgba(11, 12, 16, 0.72)', // obsidian scrim behind modals

  // ── Light-mode literals (warm, not pure white) ───────────────────────────────
  surfaceLight: '#FFFFFF',
  surfaceElevatedLight: '#FBF9F3',
  nearBlack: '#14161A', // light primary text
  textSecondaryLight: '#454B52',
  textMutedLight: '#5E656D',
  borderLight: '#E2DED3',
  dividerLight: '#ECE8DD',
  overlayLight: 'rgba(20, 22, 26, 0.45)', // scrim behind modals in light

  // ── Status colors (per-mode variants where contrast needs it) ─────────────────
  danger: '#FF5A5F', // dark-mode danger
  dangerLight: '#C62828', // light-mode danger (darker for AA on warm bg)

  // ── VoIP call-surface literals (dark-only immersive call UI, Spec 15) ─────────
  whiteAlpha50: 'rgba(255, 255, 255, 0.5)', // muted text/icon on dark call surfaces
  overlayCallDark: 'rgba(11, 12, 16, 0.92)', // near-opaque obsidian scrim behind incoming-call sheet

  // ── Offer module literals (shared offers.constants COLORS/STATE_COLORS, dark reference) ─────
  accentSubtle: 'rgba(0, 245, 212, 0.12)', // mint tint — subtle accent surface
  accentMuted: 'rgba(0, 245, 212, 0.08)', // mint tint — muted accent surface
  errorSubtle: 'rgba(255, 107, 107, 0.1)', // danger tint surface
  whiteAlpha30: 'rgba(255, 255, 255, 0.3)', // disabled text/element on dark
  whiteAlpha60: 'rgba(255, 255, 255, 0.6)', // secondary text on dark offer surfaces
  whiteAlpha20: 'rgba(255, 255, 255, 0.2)', // hairline border on dark offer surfaces
  offerDanger: '#FF6B6B', // offer/list danger red (matches legacy offers palette)
  stateGrey: '#8E8E93', // draft state grey
  stateGreyDim: '#636366', // expired state grey
  stateIndigo: '#5E5CE6', // matched state indigo
  stateGreen: '#30D158', // completed state green

  // ── Radar/Mapbox literals (always-dark custom map style, Spec offer-radar) ────
  mapClusterMid: '#1F3844', // medium cluster circle
  mapClusterLarge: '#1F4844', // larger cluster circle trending to accent
  mapClusterXL: '#0A7B6A', // large cluster circle near accent
  workZoneFill: 'rgba(0, 245, 212, 0.06)', // work-zone area fill on map
  workZoneBorder: 'rgba(0, 245, 212, 0.3)', // work-zone border on map

  // ── Misc per-domain dark literals (favorites border, kyc scrim, properties tint) ────
  borderFavorites: '#2C3A47', // favorites card border (dark)
  overlayBlackSoft: 'rgba(0, 0, 0, 0.6)', // kyc camera scrim
  accentMutedTenth: 'rgba(0, 245, 212, 0.1)', // properties muted accent tint (10%)
  success: '#2FD98B', // dark-mode success
  successLight: '#1B8A54', // light-mode success (darker for AA on warm bg)
  warning: '#FFD93D', // dark-mode warning/caution amber
  warningLight: '#B26A00', // light-mode warning (darker amber for AA on warm bg)
  onAccent: '#0B0C10', // dark text/icon sitting on mint (shared across modes)
  shadow: '#000000', // elevation shadow color (mode-independent; opacity varies at use site)
} as const;
