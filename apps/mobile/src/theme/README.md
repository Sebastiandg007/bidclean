# Theme — centralized design tokens + provider (Spec 24: dark-light-theme)

## Purpose

The single, centralized theming system for the BidClean mobile app. It provides a premium **dark
mode** (the default, brand reference) and a warm **light mode**, lets a user pick **Dark / Light /
System**, and drives the whole app — including native chrome — consistently and without a
wrong-theme flash (FOUC) on launch.

Screens consume **semantic tokens** via `useTheme()` / `useThemedStyles` — never raw hex.
`primitives.ts` is the **only** physical home for raw color values.

## Architecture (primitive → semantic → theme → provider → screens)

```
primitives.ts   ── ALL raw color values (both modes). The ONLY place a #RRGGBB / rgba() literal lives.
      │
tokens.ts       ── SemanticTokens interface (the token shape) + ThemeMode / ResolvedTheme enums.
      │
dark.theme.ts   ── darkTheme: SemanticTokens  (semantic → palette mapping ONLY, no hex; the default/reference)
light.theme.ts  ── lightTheme: SemanticTokens (semantic → palette mapping ONLY, no hex; warm parity)
      │
themes.ts       ── THEMES: Record<ResolvedTheme, SemanticTokens> + assertTokenParity()
      │
useThemeStore   ── Zustand: load/persist { version, mode } (expo-secure-store), safe fallback, last-write-wins
resolveTheme.ts ── pure resolve(mode, osScheme) → resolvedTheme
ThemeProvider   ── resolution gate (no-FOUC), memoized context, native chrome, splash hold
useTheme        ── { theme, mode, resolvedTheme, setMode }  (consumed everywhere)
useThemedStyles ── makeStyles(theme => StyleSheet) — the migration primitive
```

## Files

| File | Responsibility |
|------|---------------|
| `primitives.ts` | The single physical home for raw hex (brand seeds + all per-mode literals) |
| `tokens.ts` | `SemanticTokens` shape; `ThemeMode` / `ResolvedTheme` enums |
| `theme.constants.ts` | `DEFAULT_MODE`, `PREFERENCE_STORAGE_KEY`, `PREFERENCE_VERSION`, `THEME_BOOTSTRAP_TIMEOUT_MS` |
| `dark.theme.ts` / `light.theme.ts` | Semantic→primitive mappings (no hex) |
| `themes.ts` | `THEMES` record + `assertTokenParity()` |
| `contrast.ts` | Pure WCAG 2.1 contrast-ratio util (used by tests) |
| `useThemeStore.ts` | Zustand persistence + mode transitions (fallback DARK, bootstrap timeout, last-write-wins) |
| `resolveTheme.ts` | Pure `resolve(mode, osScheme) → resolvedTheme` |
| `ThemeContext.ts` | Context + DARK-default value |
| `ThemeProvider.tsx` | Resolution gate, splash hold, native chrome, memoized context |
| `useTheme.ts` | The app-wide hook |
| `useThemedStyles.ts` | `makeStyles` — themed StyleSheet, memoized per `resolvedTheme` |
| `useSystemChromeTheme.ts` | Status bar / Android nav bar / keyboard appearance from the resolved theme |
| `NavigationThemeBridge.tsx` | `resolvedTheme` → React Navigation theme (`toNavigationTheme`) |
| `splash.ts` | Defensive wrapper over `expo-splash-screen` (no-ops if unavailable) |
| `index.ts` | The barrel: `ThemeProvider`, `useTheme`, `makeStyles`, types, enums |

## Usage

```tsx
import { makeStyles, useTheme } from '@/theme'; // or a relative path

const useStyles = makeStyles((theme) => ({
  card: { backgroundColor: theme.surface, borderColor: theme.border },
  title: { color: theme.textPrimary },
}));

function MyScreen() {
  const { theme, mode, resolvedTheme, setMode } = useTheme();
  const styles = useStyles();
  return <View style={styles.card}><Text style={styles.title}>Hi</Text></View>;
}
```

## Rules (non-negotiable)

- **No raw hex in screens.** All color values come from `theme.*` via `useTheme()` / `useThemedStyles`.
  `primitives.ts` is the only place raw hex lives (enforced by `scripts/hex-guard.js`).
- **`mode` ≠ `resolvedTheme`.** `mode ∈ {DARK,LIGHT,SYSTEM}` (persisted); `resolvedTheme ∈ {DARK,LIGHT}` (rendered). SYSTEM is a mode, never a theme.
- **`accent` (mint) is interactive/active emphasis only** — never a background/surface, in either mode.
- **Every token exists in both themes** (compile-enforced by `SemanticTokens`; `assertTokenParity()` guards at runtime).
- **Dark is the default and reference**; light is additive parity. Both meet WCAG 2.1 AA for text/essential-UI pairs.
- **No FOUC.** The provider renders nothing themed until `(persisted mode, OS scheme)` resolve; the native splash is held until then. `THEME_BOOTSTRAP_TIMEOUT_MS` guarantees the gate never hangs.
- **`useTheme()` outside a provider** returns the DARK-default value (consistent with the DARK-fallback invariant) so isolated component tests need no provider wrapper.

## Migration guide (per file)

Replace the local `const COLORS = {…}` + `StyleSheet.create({…})` with `makeStyles`:

```tsx
// BEFORE
const COLORS = { accent: '#00F5D4', onAccent: '#0B0C10' } as const;
const styles = StyleSheet.create({ badge: { backgroundColor: COLORS.accent } });

// AFTER
const useStyles = makeStyles((theme) => ({ badge: { backgroundColor: theme.accent } }));
// inside the component: const styles = useStyles();
```

For inline color props (e.g. `ActivityIndicator color=`, `placeholderTextColor=`, reanimated
`interpolateColor`), read `const { theme } = useTheme()` and use `theme.*`.

### Token mapping cheat-sheet

| Old hardcoded value | Token |
|---------------------|-------|
| `#0B0C10` (bg) | `theme.background` (or `theme.onAccent` when it's text/icon on mint) |
| `#1F2833` (card) | `theme.surface` |
| elevated / input bg (`#252F3A`, `#2A3140`, `#141920`) | `theme.surfaceElevated` |
| `#00F5D4` (mint) | `theme.accent` |
| `#FFFFFF` (primary text) | `theme.textPrimary` |
| secondary grays (`#C5C6C7`, `#C4CCD4`, `rgba(255,255,255,0.6)`) | `theme.textSecondary` |
| muted (`rgba(255,255,255,0.5)`) | `theme.textMuted` |
| borders (`#3A4250`, `rgba(255,255,255,0.2)`) | `theme.border` |
| dividers (`rgba(255,255,255,0.08)`) | `theme.divider` |
| error reds (`#FF6B6B`, `#FF5A5F`) | `theme.danger` |
| success greens | `theme.success` |
| modal scrims (`rgba(0,0,0,0.x)`) | `theme.overlay` |

## Hex-guard

`scripts/hex-guard.js` scans `src/**` (excluding tests) and fails if any color literal appears
outside `primitives.ts`. Documented exemptions: `contrast.ts` (parses `rgba()` strings, defines no
color) and Mapbox map-style config (`radar/components/map/mapStyles.ts`, `radar/radar.constants.ts`,
`radar/components/map/CleanerMarker.tsx`, `properties/components/PropertyMap.tsx`). Run with
`npm run hex-guard`. A Jest test (`__tests__/hex-guard.spec.ts`) runs it in CI and guards migrated
files against hex regression.
