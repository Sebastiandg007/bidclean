# Stores (Zustand)

## Purpose

Global state management using Zustand. One store per domain. Stores are independent and testable in isolation.

## Stores

| Store | Data Managed |
|-------|-------------|
| `auth.store.ts` | User session, tokens, biometric status, login/logout/refresh actions |
| `role.store.ts` | Active role, assigned roles, role switching (temporary — merges into auth.store in Task 18) |
| `offers.store.ts` | Active offers, filters, search radius |
| `service.store.ts` | Current service state, checklist, tracking |
| `chat.store.ts` | Messages, translation state |
| `notifications.store.ts` | Pending notifications, badges |
| `settings.store.ts` | Language, theme (dark/light), preferences |

## Auth Store (`auth.store.ts`)

### State

| Field | Type | Description |
|-------|------|-------------|
| `user` | `AuthUser \| null` | Current authenticated user |
| `tokens` | `AuthTokens \| null` | Access token, refresh token, expiry |
| `session` | `AuthSession \| null` | Device ID, Keycloak session ID |
| `biometric` | `BiometricState` | Biometric enabled/registered/device state |
| `isAuthenticated` | `boolean` | Whether user has valid tokens |
| `isLoading` | `boolean` | Loading state for async operations |

### Actions

| Action | Description |
|--------|-------------|
| `login(tokens, user)` | Set tokens and user after OAuth callback |
| `logout()` | Clear state, call API logout |
| `logoutAll()` | Clear state, revoke all sessions |
| `refreshTokens()` | Refresh access token with Keycloak |
| `setUser(user)` | Update user data |
| `setBiometricEnabled(enabled)` | Toggle biometric preference |
| `setBiometricRegistered(registered)` | Mark biometric as registered |
| `setSession(session)` | Update session metadata |
| `hydrate()` | Load persisted tokens on app startup |
| `reset()` | Clear all auth state |
| `isTokenExpired()` | Check if access token is expired |

### Selectors

```typescript
import { useAuthStore, selectAccessToken, selectIsAuthenticated } from '@/stores/auth.store';

// Use selectors to avoid unnecessary re-renders
const token = useAuthStore(selectAccessToken);
const isAuthenticated = useAuthStore(selectIsAuthenticated);
```

### Dependencies

- `zustand` — State management
- `expo-secure-store` — Token persistence (Task 34)
- `api.service.ts` — API calls for logout (Task 32)
- Keycloak token endpoint — Token refresh (Task 33)

## Rules

- Use selectors to avoid unnecessary re-renders.
- Actions are defined inside the store.
- Persist auth store with SecureStore (encrypted).
- Never put API calls inside stores — use services layer.
