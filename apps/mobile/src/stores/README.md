# Stores (Zustand)

## Purpose

Global state management using Zustand. One store per domain. Stores are independent and testable in isolation.

## Stores

| Store | Data Managed |
|-------|-------------|
| `auth.store.ts` | User session, role, tokens, biometric status |
| `offers.store.ts` | Active offers, filters, search radius |
| `service.store.ts` | Current service state, checklist, tracking |
| `chat.store.ts` | Messages, translation state |
| `notifications.store.ts` | Pending notifications, badges |
| `settings.store.ts` | Language, theme (dark/light), preferences |

## Rules

- Use selectors to avoid unnecessary re-renders.
- Actions are defined inside the store.
- Persist auth store with SecureStore (encrypted).
- Never put API calls inside stores — use services layer.
