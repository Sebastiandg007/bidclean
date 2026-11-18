# Implementation Plan: Dark / Light Theme

## Overview

`dark-light-theme` (Spec 24, Sprint 6 — Polish & Extras) is a **mobile-only, client-only theming backbone**. It touches no backend, no money, no domain data. Its job is to consolidate BidClean's scattered, hardcoded `const COLORS` constants into a **single design-token source of truth** (`primitives.ts` = the only physical home for raw hex; semantic tokens on top), add a **light mode** beside the dark-first identity, and let a user pick **Dark / Light / System** with the whole app — including native chrome — responding consistently and without a wrong-theme flash (FOUC) on launch.

Implementation is bottom-up: token layer (primitives → semantic shape/enums → dark/light themes → THEMES record + parity guard → constants → pure WCAG contrast util) → the `useThemeStore` (Zustand persistence with safe fallback, bootstrap timeout, last-write-wins) → `ThemeProvider` + `useTheme` (resolution gate, `(mode, OS scheme) → resolvedTheme`, memoized context) → native chrome (`useSystemChromeTheme`, `NavigationThemeBridge`) → the `useThemedStyles`/`makeStyles` migration primitive → root wiring in `app/_layout.tsx` with `SplashScreen.preventAutoHideAsync()` → the Appearance UX (selector + i18n) → migration of every hardcoded screen/component onto tokens → property-based (P1–P7), unit/example, snapshot/migration tests, and the CI hex-guard → documentation. Everything is verified locally and in CI via `tsc --noEmit` + `eslint` + `jest`, with `useColorScheme`, `expo-secure-store`, `expo-splash-screen`, and `expo-status-bar` mocked — zero real device dependency.

Scope: colors/tokens + Dark/Light/System switching + migration only. No screen redesign, no server persistence / cross-device sync, no per-screen overrides, no user-authored palettes, no alternate a11y themes. Dark is the default and the reference; light is additive parity; mint `accent` is interactive/active emphasis only, never a surface. See `requirements.md` (7 requirements + REQ-TH1…REQ-TH11) and `design.md` (P1–P7).

## Tasks

- [ ] 1. Token layer — the single source of truth
  - [ ] 1.1 Create semantic token shape, mode enums, and theme constants
    - Create `apps/mobile/src/theme/tokens.ts`: `ThemeMode` enum (`DARK`/`LIGHT`/`SYSTEM`), `ResolvedTheme` enum (`DARK`/`LIGHT`), and the `SemanticTokens` interface (`background`, `surface`, `surfaceElevated`, `textPrimary`, `textSecondary`, `textMuted`, `accent`, `onAccent`, `border`, `divider`, `danger`, `success`, `overlay`) — all `string`, no `any`
    - Create `apps/mobile/src/theme/theme.constants.ts`: `DEFAULT_MODE = ThemeMode.DARK`, `PREFERENCE_STORAGE_KEY`, `PREFERENCE_VERSION = 1`, `THEME_BOOTSTRAP_TIMEOUT_MS = 2000` — named constants, no scattered literals
    - _Requirements: 1.4, 3.4, 3.5, 6.1, 6.3 · REQ-TH2, REQ-TH5, REQ-TH10_
  - [ ] 1.2 Create the primitive palette (the ONLY physical hex home)
    - Create `apps/mobile/src/theme/primitives.ts`: a `palette` const holding EVERY concrete color value for BOTH modes — brand seeds (obsidian `#0B0C10`, `surfaceDark #1F2833`, mint `#00F5D4`, white `#FFFFFF`, `warmOffWhite #F5F2EB`) plus all per-mode literals (elevated surfaces, secondary/muted text, border, divider, overlay scrims, danger/success per mode). No other file may contain a `#RRGGBB`/`rgba()` literal
    - _Requirements: 1.2, 6.1, 6.2 · REQ-TH1, REQ-TH9_
  - [ ] 1.3 Create dark and light themes (semantic→primitive mapping only, no hex)
    - Create `apps/mobile/src/theme/dark.theme.ts` (`darkTheme: SemanticTokens`, the default/reference: `background: palette.obsidian`, `surface: palette.surfaceDark`, `textPrimary: palette.white`, `accent: palette.mint`, …) and `apps/mobile/src/theme/light.theme.ts` (`lightTheme: SemanticTokens`, warm off-white background, same mint accent) — each references `palette.*` only, contains zero hex literals, and satisfies the `SemanticTokens` type (compile-enforced full shape)
    - _Requirements: 1.3, 2.1, 2.2, 2.4, 2.5 · REQ-TH3, REQ-TH4_
  - [ ] 1.4 Create THEMES record and token-parity guard
    - Create `apps/mobile/src/theme/themes.ts`: `THEMES: Record<ResolvedTheme, SemanticTokens>` and `assertTokenParity()` that throws if `keys(darkTheme) !== keys(lightTheme)` (or differ from the shape) — a dev/CI guard mirroring Property 1
    - _Requirements: 1.4, 2.4 · REQ-TH2_
  - [ ]* 1.5 Property test for token-shape parity
    - **Property 1: Token-shape parity across both themes**
    - **Validates: Requirements 1.2, 1.4, 2.4 · REQ-TH2** — every `SemanticTokens` key resolves to a defined non-empty value in both `DARK` and `LIGHT`; no dark-only/light-only token
  - [ ]* 1.6 Example tests for reference values and accent-never-a-surface
    - `darkTheme.background === '#0B0C10'`, `surface === '#1F2833'`, `textPrimary === '#FFFFFF'`, `accent === '#00F5D4'`; `lightTheme.background !== '#FFFFFF'` (warm) and `lightTheme.accent === '#00F5D4'`; in both themes `accent !== background` and `accent !== surface` (edge-case)
    - _Requirements: 1.3, 2.1, 2.2, 7.5 · REQ-TH3, REQ-TH4_

- [ ] 2. Pure WCAG contrast utility
  - [ ] 2.1 Implement contrast.ts
    - Create `apps/mobile/src/theme/contrast.ts`: a pure `contrastRatio(foreground, background)` (relative-luminance formula, handles hex + `rgba` over an opaque backdrop), single responsibility, no `any` — used by tests to assert AA
    - _Requirements: 2.3 · REQ-TH11_
  - [ ]* 2.2 Property test for WCAG 2.1 AA contrast in both themes
    - **Property 6: WCAG 2.1 AA contrast for token pairs in both themes**
    - **Validates: Requirements 2.3 · REQ-TH11** — for every defined text/essential-UI token pair (`textPrimary`/`background`, `textPrimary`/`surface`, `textSecondary`/`surface`, `onAccent`/`accent`, `danger`/`background`) in `DARK` and `LIGHT`, `contrastRatio ≥ 4.5` (normal) / `≥ 3.0` (large/essential UI)

- [ ] 3. Theme persistence store (Zustand)
  - [ ] 3.1 Implement useThemeStore load path with safe fallback + bootstrap timeout
    - Create `apps/mobile/src/theme/useThemeStore.ts`: state `{ mode, isLoaded, writeSeq }`; `load()` reads `PREFERENCE_STORAGE_KEY` from `expo-secure-store`, parses/validates `{ version, mode }`, and folds missing/`null`/malformed-JSON/non-object/unknown-`mode`/absent-`version`/thrown-read all to `DEFAULT_MODE` (`DARK`) with `isLoaded = true`; races the read against `THEME_BOOTSTRAP_TIMEOUT_MS` so a never-settling read still terminates to `DARK` + `isLoaded = true`; a late read after timeout is ignored. Never throws, never blocks indefinitely
    - _Requirements: 3.4, 3.5, 3.6 · REQ-TH5, REQ-TH7_
  - [ ] 3.2 Implement setMode last-write-wins persistence
    - Add `setMode(next)` to `useThemeStore`: update in-memory `mode` immediately, then persist `{ version: PREFERENCE_VERSION, mode: next }` on a serialized single-writer queue stamped by a monotonic `writeSeq` so a superseded in-flight write is discarded (a stale mode can never overwrite a newer one); a write failure still applies the mode for the session and is logged, not swallowed. On-device only — no network/profile write. Functions ≤ 30 lines
    - _Requirements: 3.1, 3.6 · REQ-TH5_
  - [ ]* 3.3 Property test for preference load robustness
    - **Property 4: Preference load robustness (safe default, never throws, always terminates)**
    - **Validates: Requirements 3.4, 3.5 · REQ-TH5, REQ-TH7** — arbitrary stored payloads (valid, missing, malformed JSON, non-object, unknown `mode`, wrong/absent `version`, throwing read, never-settling read) always yield a valid `ThemeMode`, never throw, always terminate; equals stored `mode` iff well-formed + supported + valid within the timeout, else `DARK`
  - [ ]* 3.4 Property test for persistence round-trip + last-write-wins
    - **Property 5: Preference persistence round-trip and last-write-wins**
    - **Validates: Requirements 3.6, 7.4 · REQ-TH5, REQ-TH7** — `setMode(m)` then reload yields `m` with shape `{ version: PREFERENCE_VERSION, mode: m }`; for any finite sequence `[m₁…mₙ]` issued faster than writes settle, the final persisted mode equals `mₙ`; no network/profile write occurs

- [ ] 4. ThemeProvider, resolution, and the useTheme hook
  - [ ] 4.1 Implement resolve(mode, osScheme) → resolvedTheme
    - Create `apps/mobile/src/theme/resolveTheme.ts` (pure): `resolve(mode, osScheme)` returns `mode` when `DARK`/`LIGHT`; `LIGHT` when `SYSTEM ∧ 'light'`; `DARK` when `SYSTEM ∧ ('dark' | null)` — never returns `SYSTEM`. `mode` is returned to callers unchanged (distinct from `resolvedTheme`)
    - _Requirements: 3.1, 3.2 · REQ-TH5, REQ-TH6_
  - [ ] 4.2 Implement ThemeProvider + useTheme with the resolution gate
    - Create `apps/mobile/src/theme/ThemeProvider.tsx` and `apps/mobile/src/theme/useTheme.ts`: on mount subscribe to `useThemeStore`, trigger `load()`, read `useColorScheme()`; `resolved = store.isLoaded && osSchemeRead`; while `!resolved` render `null` (no themed content) and keep the native splash held; compute `resolvedTheme = resolve(mode, osScheme)`, `theme = THEMES[resolvedTheme]`, memoize the context value `{ theme, mode, resolvedTheme, setMode }`; call `SplashScreen.hideAsync()` only after the resolved themed root has mounted and completed its initial layout cycle (`onLayout`); live OS-scheme change flips `resolvedTheme` in `SYSTEM` without remount; `useTheme()` throws outside a provider
    - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 7.4 · REQ-TH6, REQ-TH7, REQ-TH8_
  - [ ]* 4.3 Property test for deterministic mode resolution
    - **Property 2: Deterministic mode resolution and mode/resolvedTheme distinctness**
    - **Validates: Requirements 3.1, 3.2 · REQ-TH5, REQ-TH6** — for all `mode × osScheme`, `resolve` matches the rule table, result ∈ `{DARK,LIGHT}` (never `SYSTEM`), `mode` returned unchanged, `theme === THEMES[resolve(m,s)]`
  - [ ]* 4.4 Property test for the resolution gate (no-FOUC predicate)
    - **Property 3: Resolution gate (no-FOUC predicate)**
    - **Validates: Requirements 3.3, 7.4 · REQ-TH7** — over `(isLoaded, osSchemeAvailable) ∈ {true,false}²` with render + `hideAsync` spies: `resolved === (isLoaded && osSchemeAvailable)`; no themed render occurs while `resolved === false`; `hideAsync` is never called while `resolved === false`; no default-then-repaint state exists
  - [ ]* 4.5 Unit tests for provider contract, consistency, SYSTEM live-follow, bootstrap timeout
    - `useTheme()` returns `{ theme, mode, resolvedTheme, setMode }`, `theme === THEMES[resolvedTheme]`, throws outside provider; after `setMode` every one of multiple consumers reports the new `resolvedTheme` with none stale (consistency invariant, not a render count); `useColorScheme` flip while `SYSTEM` follows without remount; a never-settling `getItemAsync` stub + advanced fake timers past `THEME_BOOTSTRAP_TIMEOUT_MS` resolves to `DARK`, mounts, and eventually calls `hideAsync`; last-write-wins `setMode(DARK)→LIGHT→SYSTEM` with out-of-order writes persists `SYSTEM`
    - _Requirements: 3.2, 3.5, 4.1, 4.2, 7.2, 7.3 · REQ-TH6, REQ-TH7, REQ-TH8_

- [ ] 5. Native chrome theming
  - [ ] 5.1 Implement useSystemChromeTheme
    - Create `apps/mobile/src/theme/useSystemChromeTheme.ts`: apply `resolvedTheme` to native chrome the RN tree can't style directly — `expo-status-bar` style (`light` content on DARK, `dark` on LIGHT), Android navigation bar color/button style where controllable, keyboard appearance default; skip gracefully where an API is unavailable; OS-level dialogs out of scope
    - _Requirements: 4.4 · REQ-TH8_
  - [ ] 5.2 Implement NavigationThemeBridge
    - Create `apps/mobile/src/theme/NavigationThemeBridge.tsx`: map `resolvedTheme` → a React Navigation theme so headers, tab bar, card/modal presentation surfaces reflect the active theme; wrap children; token-derived colors only
    - _Requirements: 4.4 · REQ-TH8_
  - [ ]* 5.3 Unit tests for native chrome mapping
    - `DARK → status bar 'light' content`, `LIGHT → 'dark' content`; correct React Navigation theme + Android nav bar descriptors per resolved theme (chrome APIs mocked); uncontrollable OS dialogs untouched
    - _Requirements: 4.4 · REQ-TH8_

- [ ] 6. Themed styles migration primitive
  - [ ] 6.1 Implement useThemedStyles / makeStyles
    - Create `apps/mobile/src/theme/useThemedStyles.ts`: `makeStyles(factory: (theme: SemanticTokens) => T)` returning a hook that reads `useTheme()` internally and memoizes the `StyleSheet` per `resolvedTheme` (recompute once per mode change) — the replacement for per-file `const COLORS` + `StyleSheet.create`; no `any`
    - _Requirements: 4.3, 4.5, 5.4 · REQ-TH1_
  - [ ] 6.2 Create the theme barrel export
    - Create `apps/mobile/src/theme/index.ts` with explicit exports: `ThemeProvider`, `useTheme`, `useThemedStyles`/`makeStyles`, `NavigationThemeBridge`, and the `SemanticTokens`/`ThemeMode`/`ResolvedTheme` types — the app-wide theming contract (types only for consumers, never raw palette values)
    - _Requirements: 4.3, 4.5_
  - [ ]* 6.3 Unit test for useThemedStyles
    - styles recompute exactly once per `resolvedTheme` change and are memoized otherwise; produced values are token-derived (no literals)
    - _Requirements: 4.3, 5.4 · REQ-TH1_

- [ ] 7. Root wiring (provider placement + splash hold)
  - [ ] 7.1 Wire ThemeProvider into app/_layout.tsx
    - Edit `apps/mobile/app/_layout.tsx`: call `SplashScreen.preventAutoHideAsync()` at module load; nest `SafeAreaProvider > ThemeProvider > NavigationThemeBridge > <Stack/Slot>` so the whole navigation tree (above `RoleBasedNavigator`) is inside the provider; drive `useSystemChromeTheme(resolvedTheme)` from within the provider
    - _Requirements: 4.1, 4.4, 3.3 · REQ-TH7, REQ-TH8_

- [ ] 8. Appearance settings UX
  - [ ] 8.1 Implement ThemeModeSelector
    - Create `apps/mobile/src/screens/appearance/components/ThemeModeSelector.tsx`: a segmented control with three options bound to `ThemeMode` reflecting the current `mode`, the active option using `accent` (active-state emphasis, not a surface); labels from i18n keys (`appearance.mode.dark|light|system`); tapping calls `setMode`; token-styled
    - _Requirements: 7.1, 7.2, 1.3 · REQ-TH4, REQ-TH8_
  - [ ] 8.2 Implement AppearanceSettingsScreen
    - Create `apps/mobile/src/screens/appearance/AppearanceSettingsScreen.tsx` (in profile/settings): renders `ThemeModeSelector`, reflects current `mode`, BidClean token styling, `en`/`es` labels; changing mode updates the whole app + native chrome immediately with no restart
    - _Requirements: 7.1, 7.2_
  - [ ] 8.3 Add appearance i18n (en + es)
    - Add `appearance.mode.dark`, `appearance.mode.light`, `appearance.mode.system`, and appearance-screen strings to `apps/mobile/src/i18n/locales/en/…` and `es/…` with full parity
    - _Requirements: 6.4, 7.1 · REQ-TH10_
  - [ ]* 8.4 Unit test for the appearance selector
    - renders three options, active reflects current `mode`, labels resolve from i18n (`en`/`es`), token styling; tapping each calls `setMode` with the right value; whole-app update simulated via a spy
    - _Requirements: 7.1, 7.2 · REQ-TH8_
  - [ ]* 8.5 Property test for i18n en/es parity of theming labels
    - **Property 7: i18n en/es parity for theming labels**
    - **Validates: Requirements 6.4 · REQ-TH10** — every theming/appearance i18n key exists and resolves to a non-empty string in both `en` and `es`; the two locales expose an identical theming-key set

- [ ] 9. Checkpoint — token system, provider, and UX integrated
  - Ensure `apps/mobile` `tsc --noEmit` + `eslint src/` are clean and the theme + appearance Jest suites pass against mocks (`useColorScheme`, `expo-secure-store`, `expo-splash-screen`, `expo-status-bar`); ask the user if questions arise.

- [ ] 10. Migrate hardcoded colors onto tokens
  - [ ] 10.1 Migrate PaywallScreen and ProBadge
    - Rewrite `PaywallScreen` and `ProBadge` to `makeStyles(theme => …)` + `useTheme()` tokens, deleting their local `const COLORS`/inline hex; preserve prior DARK appearance (map to the same semantic values); render correctly in LIGHT
    - _Requirements: 5.1, 5.2, 5.4 · REQ-TH1, REQ-TH9_
  - [ ] 10.2 Migrate the radar/ tree
    - Migrate `RadarScreen` and the full `radar/` components off local `COLORS`/hex onto `useThemedStyles` tokens; preserve DARK appearance; render in LIGHT
    - _Requirements: 5.1, 5.2, 5.4 · REQ-TH1, REQ-TH9_
  - [ ] 10.3 Migrate the profile/ and roles/ trees
    - Migrate the full `profile/` and `roles/` screens/components (incl. `RoleBasedNavigator`) onto tokens; preserve DARK appearance; render in LIGHT
    - _Requirements: 5.1, 5.2, 5.4 · REQ-TH1, REQ-TH9_
  - [ ] 10.4 Migrate the payments/ tree and remaining shared components
    - Migrate the `payments/` tree and any remaining shared components (badge/button/card/bottom sheet) onto tokens so each works in both modes with no per-usage override; preserve DARK appearance
    - _Requirements: 5.1, 5.2, 5.4 · REQ-TH1, REQ-TH9_
  - [ ]* 10.5 Snapshot + LIGHT-smoke tests per migrated screen
    - For each migrated screen/component a DARK snapshot / token-map equivalence check confirms the tokenized version maps to the same approved values as the prior `COLORS`; each renders under LIGHT without error and with no undefined color; shared components render correctly in both themes
    - _Requirements: 5.2, 5.4 · REQ-TH9_
  - [ ]* 10.6 Update existing screen test suites to tokenized rendering
    - Update tests on migrated screens to the tokenized rendering and keep them green
    - _Requirements: 5.5 · REQ-TH9_

- [ ] 11. CI hex-guard (no raw hex outside primitives.ts)
  - [ ] 11.1 Add the hex-guard check
    - Add a CI/lint step (small script or lint rule) that greps `apps/mobile/src` for raw hex in color values (`#RRGGBB`/`rgba(...)` in style objects) and fails if any appear outside `primitives.ts` — theme files held to the same rule; scoped to application color values, excluding external SVG/raster/branding assets and third-party internals; wire into the mobile CI workflow
    - _Requirements: 1.1, 1.5, 4.3, 5.1, 5.3, 6.1, 6.2 · REQ-TH1, REQ-TH9_

- [ ] 12. Documentation
  - [ ] 12.1 Update theme + appearance READMEs
    - Rewrite `apps/mobile/src/theme/README.md` (primitive→semantic→theme, `useTheme`, `useThemedStyles`, the no-hex rule, the migration guide); add `apps/mobile/src/screens/appearance/README.md` (Dark/Light/System UX, i18n, tokens)
    - _Requirements: 6.5_
  - [ ] 12.2 Update ARCHITECTURE, CHANGELOG, ADR, and ROADMAP
    - Add the frontend theming layer to `docs/ARCHITECTURE.md` (ThemeProvider at the root above navigation, token layer, on-device preference store); add `docs/CHANGELOG.md` `[Unreleased]` entries (tokens, dark/light themes, provider + persistence, native chrome, migration); create `docs/ADR/010-centralized-theme-tokens.md` (centralized semantic tokens as source of truth, dark-as-default, on-device versioned non-synced preference, resolution-gated no-FOUC provider); mark Spec 24 status in `.kiro/specs/ROADMAP.md`
    - _Requirements: 6.5_

- [ ] 13. Final checkpoint — all tests pass, CI green, docs updated
  - Ensure `apps/mobile` `tsc --noEmit` + `eslint src/` (no `any`) + the full Jest suite (unit, property P1–P7, snapshot/migration) pass, the hex-guard reports only `primitives.ts`, and all documentation is updated; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests) and can be skipped for a faster MVP — but per this project's execution rules they are executed (unit, property-based, snapshot/migration).
- Each task references specific requirements; property-test tasks cite the design's Properties P1–P7 and the requirements' REQ-TH invariants.
- **Single source of truth:** screens consume semantic tokens via `useTheme()`/`useThemedStyles`; `primitives.ts` is the only physical home for raw hex — theme files reference `palette.*` only.
- **`mode` vs `resolvedTheme`:** `mode ∈ {DARK,LIGHT,SYSTEM}` (chosen, persisted, versioned `{version,mode}`) is distinct from `resolvedTheme ∈ {DARK,LIGHT}` (rendered); `SYSTEM` is a mode, never a theme.
- **No FOUC:** the provider renders nothing themed until `(persisted mode, OS scheme)` both resolve; the native splash is held until the resolved themed root is mounted and ready; a `SecureStore` read that never settles is bounded by `THEME_BOOTSTRAP_TIMEOUT_MS`, then falls back to `DARK`.
- **Safe recovery:** missing/invalid/corrupt/unavailable/hung storage all fold to `DARK` for the session without crashing or blocking; `setMode` is last-write-wins so a stale in-flight write never overwrites a newer mode.
- **App-wide incl. native chrome:** one `ThemeProvider` drives every screen and native chrome (status bar, tab bar, headers, Android nav bar, keyboard, modal surfaces); uncontrollable OS dialogs are out of scope.
- **Migration is mandatory:** every existing `const COLORS`/inline hex (PaywallScreen, ProBadge, RadarScreen, RoleBasedNavigator, and the full radar/, profile/, payments/, roles/ trees) is moved onto tokens; a hex-guard then finds only `primitives.ts`.
- **UI-rendering parts** (migration, native chrome application, appearance selector, splash sequencing) are verified by snapshot/render/example tests; only the pure logic core (parity, resolution, gate predicate, load robustness, round-trip, contrast, i18n parity) gets property-based tests.
- **Out of scope:** screen redesign, server persistence / cross-device sync, per-screen overrides, user-authored palettes, alternate a11y themes, non-color design tokens beyond the set, any backend/API/DB/domain change.
- CI: mobile is verified locally and in CI via `tsc --noEmit` + `eslint src/` + `jest`; there is no backend surface for this spec.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["1.4", "1.5", "1.6", "2.2"] },
    { "id": 4, "tasks": ["3.1", "3.2"] },
    { "id": 5, "tasks": ["4.1", "3.3", "3.4"] },
    { "id": 6, "tasks": ["4.2"] },
    { "id": 7, "tasks": ["4.3", "4.4", "4.5", "5.1", "5.2", "6.1"] },
    { "id": 8, "tasks": ["5.3", "6.2", "6.3"] },
    { "id": 9, "tasks": ["7.1"] },
    { "id": 10, "tasks": ["8.1", "8.3"] },
    { "id": 11, "tasks": ["8.2", "8.4", "8.5"] },
    { "id": 12, "tasks": ["10.1", "10.2", "10.3", "10.4"] },
    { "id": 13, "tasks": ["10.5", "10.6", "11.1"] },
    { "id": 14, "tasks": ["12.1", "12.2"] }
  ]
}
```
