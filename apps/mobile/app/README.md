# App Routes (`apps/mobile/app`)

## Purpose

File-based routes for expo-router. Each file maps to a URL-like route and mounts a screen or navigator from `../src`. Route files stay thin: logic and UI live in `src/screens`, `src/navigation` and `src/stores`. The directory is set as the router root by the inline Babel plugin in `../babel.config.js`.

## Files

| File | Responsibility |
|------|---------------|
| `_layout.tsx` | Root layout. Provider tree `RootErrorBoundary > SafeAreaProvider > ThemeProvider > Stack` (headers hidden). Initializes i18n with `require('../src/i18n')` inside a `try/catch`, so a failure there cannot blank the app (strings fall back to inline `defaultValue`). |
| `index.tsx` | Entry route `/`. Hydrates the persisted session from the auth store once (a hydration error degrades to Welcome). Then: authenticated with active role redirects to `/home`; authenticated without role redirects to `/roles/selection`; otherwise renders `WelcomeScreen`. Shows a spinner while hydrating. |
| `login.tsx` | `/login`. Starts the Keycloak OAuth2 Authorization Code + PKCE flow through `useOAuth` (system browser). On success seeds the auth store (`login`) and replaces the route with `/roles/selection`; on failure shows the error. Holds no credentials. |
| `register.tsx` | `/register`. Mounts `RegisterScreen`; continuing pushes `/roles/selection`. |
| `home.tsx` | `/home`. Mounts `RoleBasedNavigator`, which renders the Host or Cleaner tab navigator for the active role. |
| `roles/selection.tsx` | `/roles/selection`. Mounts `RoleSelectionScreen`. |
| `error-boundary.tsx` | `RootErrorBoundary` class component. Renders the error name, message, stack and component stack on screen instead of a blank screen, so release APK crashes are visible without Metro. |

## Dependencies

- `expo-router`, `react-native-safe-area-context`.
- `../src/theme` (`ThemeProvider`, `makeStyles`, `useTheme`), `../src/i18n`, `../src/stores/auth.store`, `../src/navigation/RoleBasedNavigator`, `../src/screens/auth` and `../src/screens/roles`.
- Keycloak and the BidClean API, through `useOAuth` and `oauth.config.ts`.

## Environment Variables

None are read directly here. See [`../README.md`](../README.md) for the `EXPO_PUBLIC_*` values used by `oauth.config.ts`.
