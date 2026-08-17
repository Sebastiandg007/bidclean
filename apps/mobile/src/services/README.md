# Services

## Purpose

External service integrations and API communication. Each service encapsulates communication with one external system.

## Services

| Service | Responsibility |
|---------|---------------|
| `api.service.ts` | HTTP client for BidClean API (Axios) |
| `secureStorage.service.ts` | Encrypted token/user persistence (expo-secure-store) |
| `socket.service.ts` | WebSocket connection (Centrifugo) |
| `map.service.ts` | Mapbox integration |
| `notification.service.ts` | OneSignal SDK |
| `purchase.service.ts` | RevenueCat SDK |
| `biometric.service.ts` | Device biometric authentication |
| `storage.service.ts` | Secure local storage |
| `tokenRefresh.service.ts` | Direct Keycloak token refresh |

## Rules

- Services are stateless — they don't hold data, stores do.
- Services return typed responses.
- Error handling happens here (transform API errors to app errors).
- Never import services directly in components — use hooks.
