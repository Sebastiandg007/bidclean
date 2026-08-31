# Subscriptions Screens (Mobile)

## Purpose

The Cleaner and Host UI for RevenueCat subscriptions (Cleaner PRO / Host PRO) and PRO/ad-free gating. RevenueCat is the IAP system of record and the BidClean backend mirror is authoritative for anything affecting money or access; the RevenueCat SDK's client-side `customerInfo` is a UI convenience only and never grants entitlements. After a purchase or restore, the client refreshes `GET /subscriptions/me` to converge on the server-authoritative view.

## Files

| File | Responsibility |
|------|---------------|
| `subscriptions.types.ts` | Mirror of the backend `/subscriptions/me` contract: entitlement keys, subscriber tier/role, entitlement state, subscription view, purchase result |
| `subscriptions.constants.ts` | Routes, `/subscriptions/me` endpoint, platform public SDK keys, entitlement/offering ids (from config), i18n keys |
| `subscriptions.api.ts` | Typed HTTP client for `GET /subscriptions/me` via the lazy shared `apiClient` |
| `useSubscription.ts` | Zustand store: configures the SDK with the internal UUID as `app_user_id`, derives client entitlements from `customerInfo`, `purchase`/`restore`, and converges to the server view via `refreshServerView` |
| `components/ProBadge.tsx` | Presentational "PRO" badge, gated per role from the server-authoritative view (`roleTiers[role] === PRO`); renders nothing when FREE |

## Dependencies

- RevenueCat SDK (`react-native-purchases`) and Paywalls UI (`react-native-purchases-ui`).
- Shared `apiClient` (`services/api.service`) for `GET /subscriptions/me` (lazy-imported).
- `zustand` for the subscription store.
- i18n namespace `subscriptions` (`i18n/locales/{en,es}/subscriptions.json`).
- Backend `subscriptions` module (server-authoritative mirror + tier resolution).

## Server Authority

The RevenueCat SDK view is optimistic UI only. Tier, role tiers, and entitlement state that gate money or access always come from the backend mirror via `GET /subscriptions/me`; the client never grants entitlements locally.

## Spec

Implements `.kiro/specs/revenuecat-subscriptions` (mobile side, task 15+).
