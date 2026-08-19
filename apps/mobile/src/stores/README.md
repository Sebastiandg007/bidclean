# Stores (Zustand)

## Purpose

Global state management using Zustand. One store per domain. Stores are independent and testable in isolation.

## Stores

| Store | Data Managed |
|-------|-------------|
| `auth.store.ts` | User session, tokens, biometric status, roles, active role, login/logout/refresh/switchRole actions |
| `role.store.ts` | **Deprecated** — re-exports from auth.store for backward compatibility |
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
| `activeRole` | `UserRole \| null` | The currently active role determining navigation |
| `roles` | `UserRole[]` | All roles assigned to this user |

### Actions

| Action | Description |
|--------|-------------|
| `login(tokens, user, roles?, activeRole?)` | Set tokens, user, and optionally role data after OAuth |
| `logout()` | Clear state, call API logout |
| `logoutAll()` | Clear state, revoke all sessions |
| `refreshTokens()` | Refresh access token with Keycloak |
| `setUser(user)` | Update user data |
| `setBiometricEnabled(enabled)` | Toggle biometric preference |
| `setBiometricRegistered(registered)` | Mark biometric as registered |
| `setSession(session)` | Update session metadata |
| `hydrate()` | Load persisted tokens on app startup |
| `reset()` | Clear all auth and role state |
| `isTokenExpired()` | Check if access token is expired |
| `switchRole(role)` | Switch active role (validates role is assigned, fire-and-forget PATCH to backend) |
| `addRole(role)` | Add a new role to the roles array (idempotent) |
| `setRoles(roles, activeRole)` | Set roles and active role from backend response |

### Selectors

```typescript
import {
  useAuthStore,
  selectAccessToken,
  selectIsAuthenticated,
  selectActiveRole,
  selectRoles,
  selectHasBothRoles,
} from '@/stores/auth.store';

// Use selectors to avoid unnecessary re-renders
const token = useAuthStore(selectAccessToken);
const isAuthenticated = useAuthStore(selectIsAuthenticated);
const activeRole = useAuthStore(selectActiveRole);
const roles = useAuthStore(selectRoles);
const hasBothRoles = useAuthStore(selectHasBothRoles);
```

### Dependencies

- `zustand` — State management
- `expo-secure-store` — Token persistence (Task 34)
- `api.service.ts` — API calls for role switching (lazy import to avoid circular deps)
- Keycloak token endpoint — Token refresh (Task 33)

## Role Store (`role.store.ts`) — Deprecated

This file is a compatibility wrapper that re-exports role state from `auth.store.ts`.
All role state was merged into the auth store in Task 18.

**New code should import directly from `auth.store.ts`.**

## Rules

- Use selectors to avoid unnecessary re-renders.
- Actions are defined inside the store.
- Persist auth store with SecureStore (encrypted).
- Never put API calls inside stores — use services layer (exception: fire-and-forget syncs like role switch).
- Role switching is instant (local state) with async backend sync.
