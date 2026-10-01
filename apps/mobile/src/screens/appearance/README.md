# Appearance settings (Dark / Light / System)

## Purpose

The user-facing surface for choosing the app theme: a **Dark / Light / System** selector that
reflects the current mode and updates the whole app (and native chrome) immediately, with no
restart. Part of Spec 24 (`dark-light-theme`). It consumes the theming backbone in
`src/theme` — it holds no colors of its own beyond token references.

## Files

| File | Responsibility |
|------|---------------|
| `AppearanceSettingsScreen.tsx` | The settings screen; renders the selector, token-styled, i18n labels |
| `components/ThemeModeSelector.tsx` | Segmented Dark/Light/System control bound to `ThemeMode`; active option uses `accent` |

## Behavior

- Reads `mode` from `useTheme()` and highlights the active option.
- Tapping an option calls `setMode(ThemeMode.*)`, which persists on-device and re-renders the app.
- The active option uses the `accent` token for active-state emphasis (never as a page surface).

## i18n

Labels come from the `appearance` namespace with `en` / `es` parity:

| Key | en | es |
|-----|----|----|
| `appearance.title` | Appearance | Apariencia |
| `appearance.mode.dark` | Dark | Oscuro |
| `appearance.mode.light` | Light | Claro |
| `appearance.mode.system` | System | Sistema |

Files: `src/i18n/locales/en/appearance.json`, `src/i18n/locales/es/appearance.json`. Parity is
enforced by a property test (`src/theme/__tests__/i18n-parity.property.spec.ts`).

## Wiring

Mount `AppearanceSettingsScreen` from the profile/settings area (e.g. a row in `SettingsScreen`).
This spec ships the screen and selector; adding the settings-row entry point is a one-line
navigation change left to the profile screen owner.
