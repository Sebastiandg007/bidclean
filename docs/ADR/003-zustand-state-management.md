# ADR-003: Zustand for State Management

## Status
Accepted

## Context
BidClean mobile app needs global state for: authentication, real-time offers (WebSocket updates), GPS tracking (updates every 3-5 seconds), service status, chat messages, and user settings. The state management solution must handle frequent updates efficiently without unnecessary re-renders.

## Decision
We chose Zustand as the state management library.

## Reasoning
- **Minimal boilerplate** — stores are 10-15 lines, promoting Clean Code.
- **Selector-based** — components only re-render when their specific data changes (critical for GPS updates every 3-5s).
- **One store per domain** — aligns with Single Responsibility Principle (authStore, offersStore, chatStore).
- **TypeScript native** — types are inferred automatically.
- **Tiny bundle** — 1.5 KB (vs Redux Toolkit at 11 KB).
- **Easy persistence** — `zustand/persist` for keeping auth state between app sessions.
- **Testable** — stores are plain functions, testable without rendering components.
- **WebSocket friendly** — can update store directly from WebSocket callbacks without dispatch ceremony.

## Alternatives Considered
- **Redux Toolkit:** More structured but significantly more boilerplate. Better for 15+ developer teams that need rigid patterns. BidClean's team doesn't need that level of ceremony.
- **Jotai:** More granular (atom-based), excellent for many independent pieces of state. But for BidClean's domain-based state (offers, auth, chat), Zustand's store-per-domain is more organized for the team.
- **React Context:** Built-in but causes full re-renders on any change. Not viable for real-time GPS/WebSocket data.

## Consequences
- Each domain gets its own store file (`stores/auth.store.ts`, `stores/offers.store.ts`).
- Store logic is separated from UI — testable in isolation.
- Team must use selectors consistently to avoid performance issues.
- No Redux DevTools (but Zustand has its own devtools middleware).
