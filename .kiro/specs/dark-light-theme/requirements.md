# Requirements Document

## Introduction

The `dark-light-theme` module gives BidClean a **single, centralized theming system** with a premium **dark mode** (the default, matching the brand's Mint & Obsidian identity) and a warm **light mode**, letting a user pick Dark / Light / System and having every screen respond consistently. It is Spec 24 of Sprint 6 (Polish & Extras), a **mobile-only / design-system** feature that touches no backend, no money, and no domain data — it depends on offer-radar (Spec 7, ✅) only in the sense that the radar/map is the most theme-sensitive surface to get right.

**It consolidates, not just adds.** Today there is **no centralized theme**: screens hardcode their own colors locally (e.g. `const COLORS = { bg: '#0B0C10', ... }` in `PaywallScreen`, `ProBadge`, and elsewhere), the brand tokens are duplicated and scattered, there is **no `useColorScheme` integration, no theme provider, no shared token set, and no light mode at all**. This directly violates the project's no-hardcoded-values rule. This spec supplies the missing foundation: a **design-token source of truth** (semantic tokens, not raw hex sprinkled per screen), a **ThemeProvider + `useTheme` hook**, dark + light palettes, a persisted user preference (Dark / Light / System), and the migration of hardcoded screen colors onto the tokens. It is the theming backbone the rest of the app consumes.

**Semantic tokens, not raw colors.** Screens SHALL consume **semantic tokens** (`background`, `surface`, `textPrimary`, `textSecondary`, `accent`, `border`, `danger`, `onAccent`, etc.) resolved by the active theme — never raw hex. The brand palette from the plan is the seed: dark background `#0B0C10`, card/surface `#1F2833`, accent (mint) `#00F5D4` used only for CTAs/actions, primary text `#FFFFFF`; light background a warm off-white `~#F5F2EB` (not pure white). Mapping raw brand colors → semantic tokens → per-mode values is the core of the design; the exact light-mode palette values are a design decision seeded by the plan.

**Authority split (kept simple — this is client-only):**
- **The design-token module is the single source of truth for colors/spacing/typography tokens.** No screen defines its own palette; all visual constants live in the token layer.
- **The user's theme preference (`mode`) is distinct from the resolved theme (`resolvedTheme`).** `mode ∈ { DARK, LIGHT, SYSTEM }` is what the user chose and what is persisted; `resolvedTheme ∈ { DARK, LIGHT }` is what actually renders (SYSTEM resolves to the OS scheme). `useTheme()` exposes both, so code never confuses "the user picked SYSTEM" with "the active theme is SYSTEM" (there is no SYSTEM theme, only a SYSTEM mode).
- **The preference is persisted on-device** (versioned), read before theme-dependent content mounts. "System" follows the OS `useColorScheme`. There is no server-side theme; theme is a pure client concern (no backend, no sync across devices in v1).
- **The active theme is provided via React context** (`ThemeProvider` + `useTheme`), which only reports a **resolved** state after both the persisted `mode` and the OS scheme are available — so a preference change re-renders the whole app consistently without prop-drilling and without a wrong-theme flash.

**Deliberate scope boundaries (to keep it focused and shippable):**
- **Colors/tokens + mode switching only.** This spec centralizes the token system and the dark/light/system switch. It does NOT redesign screens, change layouts, or restyle components beyond routing them through tokens.
- **Dark is the default and the reference.** The app ships dark-first (matching the brand); light mode is additive and must reach visual parity (readable, on-brand) but dark is the canonical design. Accent mint stays CTA-only in both modes (never a background).
- **No server persistence / cross-device sync in v1.** The preference lives on-device (persisted locally); it is not stored in the user profile or synced. If cross-device theme sync is ever wanted, it is a separate concern.
- **No per-screen theme overrides, no custom user themes.** One app-wide theme at a time (Dark/Light/System); no per-screen theming, no user-authored palettes, no high-contrast/color-blind modes in v1 (accessibility contrast is a requirement of the palette, but alternate a11y themes are out of scope).
- **Migration is mandatory, not optional.** Existing hardcoded `COLORS` constants (PaywallScreen, ProBadge, and any others) SHALL be migrated to tokens as part of this spec, removing the hardcoded-color debt; the no-hardcoded-values rule then holds for colors.
- **No flash of wrong theme (FOUC) — an implementable invariant.** The app SHALL NOT mount/render theme-dependent content until the persisted `mode` AND the OS scheme have resolved; the **native splash screen SHALL remain visible during resolution** (or an equivalent neutral hold). The app SHALL NEVER render with a default theme first and then repaint to the resolved one. `ThemeProvider` reports a `resolved` state only after resolution completes.

## Domain Model Overview

```
design tokens (new — the single source of truth; NO raw hex in screens)
  primitive palette (brand seeds): obsidian #0B0C10, surface #1F2833, mint #00F5D4,
                                    white #FFFFFF, warmOffWhite ~#F5F2EB, danger, etc.
        │ mapped into
        ▼
  semantic tokens (what screens consume):
     background, surface, surfaceElevated, textPrimary, textSecondary, textMuted,
     accent (mint — CTA/action ONLY), onAccent, border, divider, danger, success, overlay, ...
        │ resolved per mode
        ▼
  themes:
     darkTheme  (default — the brand reference)   : background=#0B0C10, surface=#1F2833,
                                                     textPrimary=#FFFFFF, accent=#00F5D4, ...
     lightTheme (additive, parity)                : background=~#F5F2EB (warm), surface=lighter,
                                                     textPrimary=near-black, accent=#00F5D4 (CTA-only), ...

theme preference (persisted on-device, VERSIONED):
  stored shape: { version, mode }   mode ∈ { DARK, LIGHT, SYSTEM }   (default = DARK)
  mode          = what the user chose (persisted)
  resolvedTheme = DARK | LIGHT   (SYSTEM resolves to the OS useColorScheme; DARK/LIGHT are explicit)
  persisted locally (no server, no cross-device sync in v1); versioned so the shape can migrate
  FAILURE RECOVERY: missing / invalid enum / corrupt / storage-unavailable → fall back to DARK for the
                    session, never crash, never block rendering indefinitely

provider + hook (resolution-gated — the FOUC invariant):
  <ThemeProvider>  resolves (persisted mode + OS scheme) → resolvedTheme; keeps native splash up until then
  useTheme() → { theme (resolved semantic tokens), mode, resolvedTheme, setMode(DARK|LIGHT|SYSTEM) }
  theme-dependent content mounts ONLY after resolution; a mode change re-renders the whole app + native
  chrome consistently (no prop-drilling, no partial theming, no default-then-repaint)

migration:
  every screen/component's local `const COLORS = {...}` and inline hex → replaced by useTheme() tokens
  (PaywallScreen, ProBadge, and all others) — removing the hardcoded-color debt
```

- **Design tokens are the single source of truth.** Screens consume semantic tokens via `useTheme()`; no screen holds its own palette or inline hex.
- **The preference is on-device and pre-paint.** Dark/Light/System, persisted locally, resolved before first render so there is no theme flash; no server persistence in v1.
- **Accent mint is reserved for interactive emphasis and selected/active states** (CTAs, links, focus indicators, active icons/toggles, progress, status badges) — and SHALL NOT be used as a primary background/surface — in both modes. (Reformulated from "CTA-only": the token may express any interactive/active emphasis, it just never becomes a primary surface.)
- **Dark is the default + reference**; light is additive and must reach readable, on-brand parity.

## Glossary

- **Primitive palette** — the raw brand color seeds (obsidian, surface, mint, white, warm off-white, danger…); not consumed directly by screens.
- **Semantic token** — a named role (`background`, `surface`, `textPrimary`, `accent`, `border`, `danger`…) that screens consume; resolves to a per-mode value.
- **Theme** — the resolved set of semantic tokens for a mode (`darkTheme` / `lightTheme`).
- **Mode** — the user's choice: `DARK` (default), `LIGHT`, or `SYSTEM` (follow the OS).
- **ThemeProvider / useTheme** — the React context provider and hook that supply the active theme app-wide and expose `setMode`.
- **System mode** — follows `useColorScheme()` from the OS, updating live when the OS switches.
- **Theme flash (FOUC)** — a visible wrong-theme frame on launch before the preference resolves; this spec forbids it.
- **Accent (mint)** — `#00F5D4`, reserved for CTAs/actions only in both modes; never a background.

## Requirements

### Requirement 1 — Centralized design tokens (single source of truth)

**User Story:** As the app, I want all colors to come from one token system, so that theming is consistent and there is no scattered hardcoded color.

#### Acceptance Criteria

1. WHEN any screen or component needs a color THEN it SHALL consume a **semantic token** via `useTheme()` (e.g. `theme.background`, `theme.accent`), and SHALL NOT define its own palette constant or inline hex literal.
2. WHEN the token system is defined THEN it SHALL map a primitive brand palette (obsidian `#0B0C10`, surface `#1F2833`, mint `#00F5D4`, white `#FFFFFF`, warm off-white `~#F5F2EB`, danger, etc.) into semantic tokens (`background`, `surface`, `surfaceElevated`, `textPrimary`, `textSecondary`, `textMuted`, `accent`, `onAccent`, `border`, `divider`, `danger`, `success`, `overlay`) resolved per mode.
3. WHEN the accent (mint) token is used THEN it SHALL be reserved for **interactive emphasis and selected/active states** (CTAs, links, focus indicators, active icons/toggles, progress, status badges) and SHALL NOT be used as a primary background/surface color in either mode (a brand rule — not a blanket "CTA-only" that would forbid legitimate active-state usage).
4. WHEN tokens are added THEN they SHALL be typed (TypeScript) so a screen referencing a non-existent token is a compile error, and the token set SHALL be identical in shape across dark and light (every semantic token exists in both).
5. WHEN a color value would otherwise be hardcoded THEN the no-hardcoded-values rule SHALL apply — colors come from tokens, not literals, in application code.

### Requirement 2 — Dark and light themes (dark default, light parity)

**User Story:** As a user, I want a polished dark mode and a comfortable light mode, so that the app looks premium in whichever I prefer.

#### Acceptance Criteria

1. WHEN the dark theme is active THEN it SHALL use the brand reference values (background `#0B0C10`, surface `#1F2833`, textPrimary `#FFFFFF`, accent `#00F5D4`) and be the default first-run theme.
2. WHEN the light theme is active THEN it SHALL use a warm off-white background (`~#F5F2EB`, not pure white), appropriately contrasting surfaces/text, and the same mint accent reserved for CTAs — reaching readable, on-brand parity with dark.
3. WHEN either theme is applied THEN text and essential UI element pairings SHALL meet a defined objective criterion — **WCAG 2.1 AA** (contrast ≥ 4.5:1 for normal text, ≥ 3:1 for large text and essential UI/graphical elements) — for the semantic token pairs that render text/controls on `background`/`surface`. The exact palette values are a design decision, but they SHALL satisfy this criterion (verified for the token pairs, not per-pixel).
4. WHEN a semantic token exists THEN it SHALL have a defined value in BOTH themes (no token is dark-only or light-only), so no screen renders an undefined color in either mode.
5. WHEN the themes are defined THEN dark SHALL remain the canonical/reference design and light SHALL be additive (no regression to the dark experience to accommodate light).

### Requirement 3 — Theme preference (Dark / Light / System), persisted, no flash

**User Story:** As a user, I want to choose my theme and have it remembered, so that the app always opens the way I like without flashing the wrong theme.

#### Acceptance Criteria

1. WHEN the user selects a theme `mode` (`DARK` / `LIGHT` / `SYSTEM`) THEN the app SHALL apply the corresponding `resolvedTheme` immediately app-wide and persist the `mode` on-device; `mode` (chosen, persisted) and `resolvedTheme` (`DARK`/`LIGHT`, rendered) are distinct and `useTheme()` SHALL expose both.
2. WHEN the `mode` is `SYSTEM` THEN `resolvedTheme` SHALL follow the OS color scheme (`useColorScheme`), switching live when the OS switches, without a restart; there is no `SYSTEM` resolvedTheme (only a `SYSTEM` mode).
3. WHEN the app launches THEN it SHALL NOT mount theme-dependent content until the persisted `mode` AND the OS scheme have resolved — the **native splash SHALL remain visible during resolution** (or an equivalent neutral hold) — and the app SHALL NEVER render a default theme first then repaint to the resolved one (no FOUC, as an implementable invariant, not just a visual goal).
4. WHEN no preference has ever been set THEN the app SHALL default to `DARK` (the brand default), configurable to `SYSTEM` via a named default constant (not hardcoded scatter).
5. WHEN the persisted preference is missing, an invalid enum, corrupt, or local storage is unavailable THEN the app SHALL fall back to `DARK` for the session, SHALL NOT crash, and SHALL NOT block rendering indefinitely; the persisted value SHALL be a versioned shape `{ version, mode }` so the storage format can migrate.
6. WHEN the preference is persisted THEN it SHALL live on-device only (local storage) — not in the user profile, not synced across devices in v1.

### Requirement 4 — App-wide provider (consistent, no partial theming)

**User Story:** As the app, I want one provider to drive theming everywhere, so that a mode change updates every screen consistently.

#### Acceptance Criteria

1. WHEN the app renders THEN a `ThemeProvider` at the root SHALL compute the active theme from `(preference, OS scheme)` and provide it via React context; `useTheme()` SHALL return `{ theme, mode, setMode }`.
2. WHEN the mode changes THEN the whole app SHALL re-render with the new theme consistently — no screen SHALL retain the old theme, and there SHALL be no prop-drilling of colors.
3. WHEN a component reads theme THEN it SHALL do so via `useTheme()` (or a themed style helper), never by importing a raw palette module directly for values.
4. WHEN navigation/system chrome is themed THEN the following SHALL reflect the active theme: the **status bar** (content light on dark / dark on light), the **tab bar**, **navigation headers**, **modal/presentation surfaces**, the Android **navigation bar**, and the **keyboard appearance** where applicable. System dialogs not controllable by the app (OS-level alerts) are explicitly out of scope. "App-wide theme" SHALL cover native chrome, not only React component trees.
5. WHEN a new screen is built THEN it SHALL be theme-aware by construction (consuming tokens), so parity is maintained without per-screen retrofits.

### Requirement 5 — Migration of existing hardcoded colors

**User Story:** As a maintainer, I want the existing scattered color constants replaced by tokens, so that the theme system actually governs the whole app and the hardcoded-color debt is gone.

#### Acceptance Criteria

1. WHEN this spec is implemented THEN every existing local `const COLORS = {...}` and inline hex in screens/components (PaywallScreen, ProBadge, and all others) SHALL be migrated to `useTheme()` tokens.
2. WHEN a screen is migrated THEN its dark-mode appearance SHALL preserve its prior semantic appearance, verified in a **testable** way — the migrated screen maps to the same approved token values / snapshot in DARK (a token-level or snapshot check, not necessarily pixel-perfect freezing) — and it SHALL additionally render correctly in light mode.
3. WHEN the migration is complete THEN a search for raw brand hex literals (`#0B0C10`, `#1F2833`, `#00F5D4`, etc.) in application **color values** SHALL return only the token definition layer — not scattered usages. This applies to color values in application code, NOT to external SVG/raster/branding assets or third-party component internals outside the project's control.
4. WHEN a shared component (badge, button, card, bottom sheet) is themed THEN it SHALL derive all colors from tokens so it works in both modes without per-usage overrides.
5. WHEN migration touches a screen with tests THEN the tests SHALL be updated to the tokenized rendering and remain green.

### Requirement 6 — Configuration, quality, and no hardcoded values

**User Story:** As an operator/maintainer, I want theming to follow the project's standards, so that it stays consistent and maintainable.

#### Acceptance Criteria

1. WHEN theme defaults are set (default mode, whether first-run is DARK or SYSTEM) THEN they SHALL be defined as named constants/config, not scattered literals; the brand palette SHALL live in one token definition file.
2. WHEN colors are used in application code THEN NO raw hex literal SHALL appear outside the token definition layer (enforcing no-hardcoded-values for **color values**); the token file is the one allowed place for hex. This does NOT apply to external assets (SVG/raster/branding files) or third-party component internals — the rule targets application color values, avoiding false positives on assets outside the project's control.
3. WHEN the theme system is built THEN it SHALL be TypeScript-typed (token shape, mode enum) with no `any`, consistent with the project's TS standards.
4. WHEN UI text related to theming is shown (settings labels: "Dark", "Light", "System") THEN it SHALL come from i18n keys with `en`/`es` parity.
5. WHEN the theme system or its migration is introduced THEN it SHALL be documented (a mobile theming README, ARCHITECTURE note if structural, CHANGELOG, and an ADR for the centralized-token + dark-default + on-device-preference decision) per the project documentation rules.

### Requirement 7 — Mobile theming UX

**User Story:** As a user, I want to change my theme easily and see the whole app respond, so that it feels polished and mine.

#### Acceptance Criteria

1. WHEN the user opens appearance settings (in profile/settings) THEN they SHALL see a Dark / Light / System selector reflecting the current mode, with `en`/`es` labels and BidClean styling.
2. WHEN the user changes the mode THEN the entire app SHALL update immediately (no restart), including the current screen, tab bar, and system chrome.
3. WHEN the OS theme changes while in `SYSTEM` mode THEN the app SHALL follow it live.
4. WHEN the app is relaunched THEN it SHALL restore the last chosen mode with no theme flash.
5. WHEN theming renders THEN both modes SHALL preserve the brand feel (dark = premium obsidian/mint; light = warm off-white with mint CTAs) and mint SHALL remain CTA-only.

## Correctness Properties (business invariants)

The design defines concrete, testable properties (its own numbering) mapping back to these.

- **REQ-TH1 — Single source of truth.** All colors come from the semantic-token layer via `useTheme()`; no screen defines its own palette or inline hex; the token file is the only place raw hex lives. *(Req 1.1, 1.5, 6.2)*
- **REQ-TH2 — Token-shape parity.** Every semantic token has a value in BOTH dark and light themes (identical shape); a screen can never reference an undefined color in either mode; typed so a missing token is a compile error. *(Req 1.4, 2.4)*
- **REQ-TH3 — Dark default + reference.** First run is DARK with the brand reference values; light is additive parity and never regresses the dark experience. *(Req 2.1, 2.5, 3.4)*
- **REQ-TH4 — Accent is interactive/active emphasis, never a surface.** The `accent` (mint) token is used for CTAs, links, focus/selected/active states — and never as a primary background/surface — in both modes. *(Req 1.3, 7.5)*
- **REQ-TH5 — mode vs resolvedTheme are distinct; persisted on-device with safe recovery.** `mode ∈ {DARK,LIGHT,SYSTEM}` (persisted, versioned `{version,mode}`) is distinct from `resolvedTheme ∈ {DARK,LIGHT}` (rendered); `useTheme()` exposes both; missing/invalid/corrupt/unavailable storage falls back to DARK without crashing; never server-stored or synced in v1. *(Req 3.1, 3.5, 3.6)*
- **REQ-TH6 — System mode follows the OS live.** In SYSTEM mode `resolvedTheme` tracks `useColorScheme` and switches live without restart. *(Req 3.2, 7.3)*
- **REQ-TH7 — No theme flash (resolution-gated).** Theme-dependent content does not mount until `mode` + OS scheme resolve, with the native splash held during resolution; the app never renders a default theme then repaints. *(Req 3.3, 7.4)*
- **REQ-TH8 — App-wide consistency incl. native chrome.** One ThemeProvider drives the whole app; a mode change re-renders every screen AND native chrome (status bar, tab bar, headers, modals, Android nav bar, keyboard) consistently; no partial theming, no prop-drilling; uncontrollable OS dialogs are out of scope. *(Req 4.1, 4.2, 4.4, 7.2)*
- **REQ-TH9 — Migration completeness + verifiable no-dark-regression.** All existing hardcoded `COLORS`/hex color values are migrated to tokens; migrated screens preserve their prior DARK appearance verified via token/snapshot approval; a hex search over application color values finds only the token layer (external assets/third-party internals exempt). *(Req 5.1, 5.2, 5.3, 6.2)*
- **REQ-TH11 — Objective contrast criterion.** Token pairs rendering text/essential UI meet WCAG 2.1 AA (≥4.5:1 normal text, ≥3:1 large text/essential UI) in both themes. *(Req 2.3)*
- **REQ-TH10 — Standards + i18n.** Theming is TS-typed (no `any`), defaults are named config, theming labels are `en`/`es` i18n, and the decision is documented (ADR). *(Req 6.1, 6.3, 6.4, 6.5)*

## Non-Goals

- Redesigning screens, changing layouts, or restyling beyond routing colors through tokens — this is a theming backbone, not a visual redesign.
- Server-side theme persistence or cross-device sync — the preference is on-device only in v1.
- Per-screen theme overrides, user-authored custom palettes, or a theme marketplace.
- High-contrast / color-blind / alternate accessibility themes (the base palette must be legible, but alternate a11y themes are out of scope for v1).
- Theming non-color design decisions beyond the token set (motion, haptics, sound remain their own concerns).
- Any backend, API, database, or domain change — this spec is purely client-side (mobile).
- Introducing a new UI component library — tokens theme the existing custom components.
