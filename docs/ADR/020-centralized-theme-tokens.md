# ADR-020: Centralized theme tokens, dark-as-default, on-device preference, resolution-gated no-FOUC provider

## Status

Accepted

## Context

Spec 24 (`dark-light-theme`) is a mobile-only, client-only theming backbone. Before it, the
BidClean mobile app had **no centralized theme**: 30+ screens/components each declared their own
local `const COLORS = { … }` with raw hex (`PaywallScreen`, `ProBadge`, `RadarScreen`,
`RoleBasedNavigator`, the whole `radar/`, `profile/`, `payments/`, `roles/` trees, …). Brand tokens
were duplicated per file, there was no `useColorScheme` integration, no theme provider, no shared
token set, and no light mode — directly violating the project's no-hardcoded-values rule.

We needed to decide: how colors are defined and consumed, how the dark/light/system preference is
stored and resolved, and how the app switches themes without a wrong-theme flash on launch.

## Decision

1. **One semantic token layer, with a single physical hex home.** All raw color values (both modes)
   live only in `apps/mobile/src/theme/primitives.ts`. A typed `SemanticTokens` shape defines named
   roles (`background`, `surface`, `textPrimary`, `accent`, `border`, `danger`, …). `dark.theme.ts`
   and `light.theme.ts` do semantic→primitive mapping only (zero hex). Screens consume tokens via
   `useTheme()` / `useThemedStyles` — never raw hex. A static hex-guard enforces "no `#RRGGBB`
   outside `primitives.ts`".
2. **React context distributes the resolved theme; Zustand backs persistence.** The resolved theme
   is read by nearly every component, so context (not prop-drilling, not a store read per consumer)
   propagates a mode change consistently. A small `useThemeStore` (Zustand — the project's state
   tool) owns the persisted `{ version, mode }` and the mode transitions.
3. **Dark is the default and the reference** (`DEFAULT_MODE = DARK`), with the brand values
   (`#0B0C10` / `#1F2833` / `#FFFFFF` / `#00F5D4`). Light is additive parity (warm off-white, same
   mint accent reserved for interactive/active emphasis). Both meet WCAG 2.1 AA for text/essential-UI
   token pairs.
4. **`mode` (persisted choice) is distinct from `resolvedTheme` (rendered).** `mode ∈
   {DARK,LIGHT,SYSTEM}`; `resolvedTheme ∈ {DARK,LIGHT}`. SYSTEM resolves live to the OS
   `useColorScheme`. There is no SYSTEM theme.
5. **On-device, versioned preference; no server persistence / cross-device sync (v1).** Stored as
   `{ version, mode }` in `expo-secure-store`. Missing / invalid / corrupt / unavailable / hung
   storage all fall back to DARK without crashing; a bootstrap timeout bounds a never-settling read.
   `setMode` is last-write-wins.
6. **Resolution-gated no-FOUC provider.** `ThemeProvider` renders nothing themed until both the
   persisted mode and the OS scheme resolve; the native splash is held until the resolved themed
   root is mounted. It never renders a default theme then repaints.
7. **Native chrome themed centrally** (status bar, Android nav bar, keyboard, React Navigation
   theme) from the resolved theme in the provider.

## Consequences

**Easier:**
- A palette tweak is one edit in the token layer; accent-as-emphasis is expressible without leaking
  `#00F5D4` into screens.
- New screens are theme-aware by construction (consume tokens); parity is automatic.
- The no-hardcoded-values rule for colors is enforceable by CI (hex-guard).
- Adding light mode (and switching default to SYSTEM) is a config change, not a rewrite.

**Harder / trade-offs:**
- Existing screens must be migrated off local `COLORS` onto tokens (a mechanical but broad change);
  the migration is incremental and tracked by the hex-guard.
- `useTheme()` returns a DARK-default value outside a provider (rather than throwing) so that
  isolated component tests keep working without a provider wrapper — a deliberate consistency with
  the DARK-fallback invariant, documented so it is not mistaken for a missing guard.
- `expo-splash-screen` is wrapped defensively (it is not currently installed in the toolchain); the
  splash hold degrades to a safe no-op when the native module is absent.

## Notes

- The design document references "ADR-010" for this decision, but `010` was already taken
  (`010-configuration-inventory-and-secret-boundary.md`); this decision is recorded as **ADR-020**
  (the next free sequential number at authoring time).
