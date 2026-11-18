# @bidclean/mobile

## Purpose

BidClean mobile application for iOS, Android and Samsung Galaxy Store. Built with React Native and Expo, one codebase serving both the Host and Cleaner roles. The app uses native modules (Mapbox, Stripe, LiveKit, AdMob, camera, biometrics), so it does not run in Expo Go: it needs an EAS cloud build or a local development build.

## Tech

- **Framework:** React Native 0.76 + Expo SDK 52 (`newArchEnabled: false`)
- **Navigation:** expo-router (file routes in `app/`) + role-based tab navigators
- **State:** Zustand (global auth/role stores, feature stores next to their screens)
- **Animations:** Reanimated 3
- **Maps:** `@rnmapbox/maps`
- **Calls:** LiveKit (`@livekit/react-native`)
- **Payments / subscriptions / ads:** Stripe React Native, `react-native-purchases` (RevenueCat), `react-native-google-mobile-ads`
- **i18n:** i18next + react-i18next (en, es)

## Files

| File / Folder | Responsibility |
|---------------|---------------|
| `app.config.js` | Dynamic Expo config (replaces `app.json`). Name `BidClean`, slug `bidclean`, owner `bidclean`, scheme `bidclean`, bundle id/package `tech.bidclean.app`, `extra.eas.projectId`. `newArchEnabled: false`: on RN 0.76 the New Architecture failed silently at startup (blank screen before any JS) with LiveKit/WebRTC and Mapbox; re-enable when all native deps support it. Native plugins: `expo-router`, `expo-secure-store`, `@rnmapbox/maps` (`RNMapboxMapsDownloadToken` from `MAPBOX_DOWNLOAD_TOKEN`), `react-native-google-mobile-ads` (app ids from env, Google test app id by default), `@stripe/stripe-react-native` (merchant id, Google Pay), `expo-camera`, `expo-location`, `expo-image-picker`, `expo-local-authentication`, `expo-tracking-transparency` (permission texts). |
| `eas.json` | EAS Build profiles: `development` (dev client, internal APK), `preview` (internal APK; env `EXPO_PUBLIC_API_URL=https://api.bidclean.tech` and `EXPO_ROUTER_APP_ROOT=apps/mobile/app`), `production` (AAB, `autoIncrement`). `appVersionSource: local`. |
| `BUILD.md` | Step-by-step EAS build guide (Spanish). |
| `metro.config.js` | `getDefaultConfig` plus monorepo `watchFolders` and `nodeModulesPaths`. A `resolveRequest` hook forces a single copy of `react`, `react-native`, `react-native-safe-area-context`, `react-native-screens` and `react-native-reanimated`, resolved from the app. Cause: npm installed two copies of safe-area-context (one hoisted for React Navigation), which crashed at startup with "Tried to register two views with the same name RNCSafeAreaProvider". |
| `babel.config.js` | `babel-preset-expo` plus an inline plugin that replaces `process.env.EXPO_ROUTER_APP_ROOT` with a path relative to the `_ctx` file being transformed (`path.relative(dirname(state.filename), app/)`), `EXPO_ROUTER_IMPORT_MODE` with `'sync'` and `EXPO_ROUTER_ABS_APP_ROOT` with the absolute routes path. Cause: in this monorepo `babel-preset-expo` is hoisted but `expo-router` is not, so the preset's `hasModule('expo-router')` check fails and the substitution never runs; routes would not register (blank screen). An absolute path would not work on device. In the Jest `test` env it adds `babel-plugin-dynamic-import-node`. |
| `.gitignore` | Ignores `dist-web/`, `dist/`, `.expo/`, `web-build/`, preview server logs and generated native folders `android/` and `ios/`. |
| `package.json` | Package `@bidclean/mobile`, entry `expo-router/entry`, scripts (`dev`, `build:android`, `build:ios`, `test`, `lint`, `typecheck`, `hex-guard`, `android`, `ios`), and Jest config (`jest-expo` preset, setup `src/__mocks__/setup.ts`). |
| `tsconfig.json` | Extends `../../tsconfig.base.json`; aliases `@/*` to `src/*` and `@bidclean/shared`; includes `src/**/*` and `app/**/*`. |
| [`app/`](app/README.md) | expo-router routes. |
| [`src/`](src/README.md) | Application code. |
| `scripts/hex-guard.js` | Fails if a raw hex or `rgba()` literal appears in `src/**` outside `src/theme/primitives.ts` (documented exemptions for Mapbox style config). Run with `npm run hex-guard`; also executed by a Jest test. |

## Structure

```
apps/mobile/
├── app/                 → expo-router routes (_layout, index, login, register, home, roles/selection, error-boundary)
├── src/
│   ├── navigation/      → RoleBasedNavigator, HostNavigator, CleanerNavigator
│   ├── screens/         → Feature screens (ads, appearance, auth, chat, checklist, completion, dispute,
│   │                      favorites, kyc, negotiation, notifications, offers, payments, profile, properties,
│   │                      radar, roles, subscriptions, tracking, verification)
│   ├── stores/          → Global Zustand stores (auth, role)
│   ├── services/        → api (axios), tokenRefresh, secureStorage
│   ├── theme/           → Design tokens, ThemeProvider, NavigationThemeBridge
│   ├── i18n/            → i18next setup and en/es resources
│   ├── components/ hooks/ utils/   → Shared code (documentation only so far)
│   ├── types/           → Ambient .d.ts declarations
│   └── __mocks__/       → Jest setup and native mocks
├── scripts/             → hex-guard.js
├── app.config.js · eas.json · metro.config.js · babel.config.js · BUILD.md
└── package.json · tsconfig.json · .gitignore
```

## Dependencies

- `@bidclean/shared` (workspace package) for shared types and constants.
- Runtime: `expo ~52`, `expo-router`, `react-native 0.76.9`, `zustand`, `axios`, `i18next`, `react-native-reanimated`, `react-native-safe-area-context`, `react-native-screens`.
- Native SDKs: `@rnmapbox/maps`, `@stripe/stripe-react-native`, `@livekit/react-native` (+ `-webrtc`), `react-native-purchases`, `react-native-google-mobile-ads`, `expo-camera`, `expo-location`, `expo-local-authentication`, `expo-secure-store`, `expo-navigation-bar`, `expo-splash-screen`.
- Dev: `jest`, `jest-expo`, `@testing-library/react-native`, `fast-check`, `babel-plugin-dynamic-import-node`.
- Backends: the BidClean API (`api.bidclean.tech`) and Keycloak (`auth.bidclean.tech`).

## Environment Variables

`EXPO_PUBLIC_*` values are inlined at build time. Defaults come from `src/screens/auth/oauth.config.ts` and `app.config.js`.

| Variable | Description | Required |
|----------|-------------|----------|
| `EXPO_PUBLIC_API_URL` | API base URL (default `https://api.bidclean.tech`) | No |
| `EXPO_PUBLIC_KEYCLOAK_URL` | Keycloak base URL (default `https://auth.bidclean.tech`) | No |
| `EXPO_PUBLIC_KEYCLOAK_REALM` | Keycloak realm (default `bidclean`) | No |
| `EXPO_PUBLIC_KEYCLOAK_CLIENT_ID` | OAuth client id (default `bidclean-mobile`) | No |
| `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` | Public Mapbox token (`pk.*`) for the runtime map | Yes for a visible map |
| `MAPBOX_DOWNLOAD_TOKEN` | Build-time secret (`sk.*`, `DOWNLOADS:READ`) used by Gradle to download the native Mapbox SDK. Not `EXPO_PUBLIC`. | Yes for EAS Android builds |
| `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key | Yes for payments |
| `EXPO_PUBLIC_LIVEKIT_URL` | LiveKit server URL for calls | Yes for calls |
| `EXPO_PUBLIC_ADMOB_ANDROID_APP_ID` / `EXPO_PUBLIC_ADMOB_IOS_APP_ID` | AdMob app ids (default: Google test app id) | No |
| `EXPO_PUBLIC_RC_ANDROID_KEY` / `EXPO_PUBLIC_RC_IOS_KEY` | RevenueCat SDK keys | Yes for subscriptions |
| `EXPO_PUBLIC_RC_ENTITLEMENT_*` / `EXPO_PUBLIC_RC_OFFERING_*` | RevenueCat entitlement and offering ids (host pro, cleaner pro, ad free) | Yes for subscriptions |

Many other optional `EXPO_PUBLIC_*` tuning values (radar, offers, properties, chat, KYC limits, Mapbox styles, OneSignal, Centrifugo, ads) are listed in the root `.env.example` and in [`../../docs/CONFIGURATION-INVENTORY.md`](../../docs/CONFIGURATION-INVENTORY.md).

## How to Run

There is no Expo Go support, because the app depends on custom native modules. Use an EAS build (see [`BUILD.md`](BUILD.md)).

```powershell
# PowerShell, from the repo root
npm install
cd apps/mobile
npx eas build --platform android --profile preview   # installable APK, needs MAPBOX_DOWNLOAD_TOKEN
npx jest                                             # unit tests
npm run typecheck
npm run hex-guard
```

Diagnosing a build on an Android emulator:

```powershell
adb install -r app.apk
adb logcat *:E ReactNative:V ReactNativeJS:V
```

The root `RootErrorBoundary` prints JS errors on screen, so most failures are visible without a log. Native or graphics errors (for example `EGL_KHR_swap_buffers_with_damage` on some emulators) only appear in logcat and do not necessarily come from the app.
