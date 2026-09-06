# Notifications (Mobile — Spec 16)

## Purpose

The client side of push notifications: request OS permission, register the device with the backend registry (Model B), route a tapped push to the right screen (reconciling authoritative state via GET), open the Spec 15 incoming-call UI for a call push, and let the user manage categories + quiet hours. Foreground de-dup is client-preferred and **fail-open** — messages and calls always surface.

The public OneSignal app id comes from `EXPO_PUBLIC_ONESIGNAL_APP_ID`; the REST key never reaches the client.

## Files

| File | Responsibility |
|------|---------------|
| `notifications.types.ts` | Client types (deep-link, preferences, permission status) |
| `notifications.constants.ts` | Endpoints, deep-link → route map, categories, i18n keys, public app id |
| `notifications.api.ts` | Typed HTTP access (register/consent/unregister, get/update preferences) |
| `notifications.store.ts` | Zustand store: device/permission state, preferences, foreground de-dup bookkeeping |
| `onesignal.sdk.ts` | Thin seam over the OneSignal SDK (`toReceivedPush`, no-op default) — testable without a native dep |
| `useNotificationBootstrap.ts` | After auth: permission → init SDK → player id → register device (denied ⇒ consent=false) |
| `useNotificationRouting.ts` | Parse deep-link → navigate + GET-reconcile; `incoming_call` opens the call sheet |
| `NotificationSettingsScreen.tsx` | Toggle categories + quiet hours; BidClean dark tokens; en/es i18n |

## Dependencies

- `services/api.service` (shared `apiClient`) for the backend endpoints.
- `react-i18next` for `en`/`es` strings (`notifications` namespace).
- The OneSignal native SDK is injected via the `OneSignalSdk` seam at the app shell (not a direct import), so unit tests run without a native module. Wire `react-native-onesignal` there when integrating the real transport.

## API (consumed)

| Method | Path |
|--------|------|
| POST | `/notifications/devices` |
| PATCH | `/notifications/devices/:playerId/consent` |
| DELETE | `/notifications/devices/:playerId` |
| GET/PUT | `/notifications/preferences` |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `EXPO_PUBLIC_ONESIGNAL_APP_ID` | Public OneSignal app id (never the REST key) | Yes (for real push) |

Note: `EXPO_PUBLIC_*` variables are statically inlined by `babel-preset-expo`; tests mock `notifications.constants` to supply the id.

## Tests

Store (device/preference actions, fail-open foreground de-dup), routing (deep-link → route, incoming-call handoff), bootstrap (permission-denied ⇒ consent=false, never crashes), settings screen render/persist, and en/es i18n parity. The OneSignal SDK and `apiClient` are mocked (zero real external calls).
