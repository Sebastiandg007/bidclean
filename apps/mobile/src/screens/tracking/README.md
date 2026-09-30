# tracking (Spec 17 — mobile)

## Purpose
The mobile surface for service tracking: the Cleaner's `EnRouteScreen` (reports position to the backend and starts the service) and the Host's `TrackingScreen` (watches the live position + state on a Mapbox map). Live position is ephemeral; the backend is on the path (Option A) — the Cleaner POSTs samples and never publishes to the channel, and the Host is a read-only subscriber. Mapbox renders position/destination only; it is never the source of truth (that is Centrifugo transport + the server geofence, reconciled via `GET`).

## Files
| File | Responsibility |
|------|---------------|
| `tracking.types.ts` | `ServiceSession`, `LivePosition`, `SessionState`, `ConnectionStatus`, realtime signal shapes |
| `tracking.constants.ts` | Endpoints, channel prefix, client send cadence (`EXPO_PUBLIC_SERVICE_POSITION_MIN_INTERVAL_MS`), map defaults, dark tokens, i18n keys |
| `tracking.labels.ts` | Pure `stateLabelKey(state)` → i18n key mapping (shared by both screens) |
| `tracking.api.ts` | Typed calls over the shared `apiClient` (get/en-route/position/start/cancel + Centrifugo tokens) |
| `tracking.store.ts` | Zustand store: session + latest live position + connectionStatus; idempotent state-signal application (no regression), `reconcile` via `GET`, reset |
| `usePositionReporter.ts` | Cleaner: permission + throttled position POST while `EN_ROUTE`; graceful denial (no crash); never publishes |
| `useTrackingChannel.ts` | Host: read-only WS subscribe (token fetch, backoff reconnect, foreground reconcile, teardown); parses position + state signals |
| `EnRouteScreen.tsx` | Cleaner UI: destination, "I'm heading out", "Start" enabled only when `ARRIVED`, permission explainer |
| `TrackingScreen.tsx` | Host UI: Mapbox live position + destination, state label, "Cleaner has arrived", "location unavailable" |

## Dependencies
- Shared `apiClient` (`services/api.service`), `expo-location` (Cleaner), `@rnmapbox/maps` (render only), Zustand, `react-i18next`.
- Backend `service-sessions` endpoints + the auth `/auth/centrifugo/token` route.

## Navigation
- `EnRouteScreen` is reachable from the Cleaner active-job stack (`CleanerNavigator`, route `EnRoute`), keyed by `sessionId`.
- `TrackingScreen` is reachable from the Host offers stack (`HostNavigator`, route `Tracking`), keyed by `sessionId`.

## i18n
`src/i18n/locales/{en,es}/tracking.json` (keys under the `tracking` namespace, en/es in parity). Dark BidClean tokens: accent `#00F5D4`, card `#1F2833`, background `#0B0C10`.
