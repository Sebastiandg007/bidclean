# Mobile Source (`apps/mobile/src`)

## Purpose

Application code of the mobile app. Route files in `../app` stay thin and mount screens and navigators from here. Code is organized by feature under `screens/`, with global infrastructure in the other folders. Feature stores are co-located with their screens; only the auth and role stores are global.

## Files

| Folder | Responsibility |
|--------|---------------|
| [`screens/`](screens/README.md) | Feature screens, each with its own components, hooks and (where applicable) feature store. |
| [`navigation/`](navigation/README.md) | `RoleBasedNavigator`, `HostNavigator`, `CleanerNavigator`. |
| [`stores/`](stores/README.md) | Global Zustand stores: `auth.store.ts`, `role.store.ts`. |
| [`services/`](services/README.md) | `api.service.ts` (axios instance), `tokenRefresh.service.ts`, `secureStorage.service.ts`. |
| [`theme/`](theme/README.md) | Design tokens, `ThemeProvider`, navigation theme bridge, native chrome. |
| [`i18n/`](i18n/README.md) | i18next setup and en/es resources (17 namespaces). |
| [`components/`](components/README.md) | Shared UI components (documentation only so far). |
| [`hooks/`](hooks/README.md) | Shared hooks (documentation only so far). |
| [`utils/`](utils/README.md) | Pure helpers (documentation only so far). |
| [`types/`](types/README.md) | Ambient `.d.ts` declarations. |
| `__mocks__/` | Jest setup (`setup.ts`) with mocks for native modules. |

## Dependencies

- `../app` consumes this folder. `@bidclean/shared` provides shared types and constants (`@/*` alias maps to `src/*`).
- Native modules (Mapbox, Stripe, LiveKit, AdMob, camera, location) require an EAS build; see [`../BUILD.md`](../BUILD.md).
