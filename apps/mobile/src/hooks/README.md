# Hooks

## Purpose

Custom React hooks that encapsulate reusable logic. Hooks connect stores with services and provide a clean API for screens.

## Rules

- One hook = one concern.
- Hooks are testable independently of UI.
- Naming: `useXxx` (e.g., `useAuth`, `useOffers`, `useLocation`).
- Screen-specific hooks live in their screen folder, not here.
- Only globally reusable hooks belong here.
