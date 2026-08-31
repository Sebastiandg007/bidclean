# Payments Screens (Mobile)

## Purpose

The mobile-side type contract and UI for the Stripe escrow flow. This module mirrors the backend payment view so the app can display a payment's financial lifecycle, dispute and payout status, the monetary breakdown, and a Cleaner's Stripe Connected Account status. The server is authoritative — the client never makes payment decisions; it only renders server state and initiates requests (onboarding, refund).

## Files

| File | Responsibility |
|------|---------------|
| `payments.types.ts` | Mobile-side interfaces for the escrow flow: `PaymentStatus` / `DisputeStatus` / `PayoutStatus` lifecycles, `PaymentBreakdown` (integer cents), the combined `PaymentView`, `StripeAccountStatus`, `OnboardingResult`, and `RefundResult` |
| `payments.constants.ts` | Route names, REST endpoint builders, the `Idempotency-Key` header, the Stripe publishable key (from env), and i18n error keys |
| `payments.api.ts` | Typed HTTP client for the payment endpoints (onboarding, account status, fetch payment, refund); attaches a crypto-random `Idempotency-Key` to the refund mutation |
| `payments.format.ts` | `formatMoney` — formats integer cents into a locale-aware currency string, with a plain-string fallback |
| `payments.status-map.ts` | Pure helpers mapping payment/payout/dispute statuses to i18n label keys (`status.<domain>.<STATUS>`) and semantic `BadgeTone` values for `PaymentStatusBadge` |
| `usePayments.ts` | Zustand store (`usePaymentsStore`): fetch payment, full/partial refund with error-to-i18n-key mapping (409 blocked, 422 ceiling), account status, payout-onboarding gate; server-authoritative |
| `PaymentStatusScreen.tsx` | Host/Cleaner screen rendering the three orthogonal statuses (payment/payout/dispute), the locale + currency money breakdown, a dispute banner while a dispute is open, and a Host-only refund entry; renders what `usePayments` fetched |
| `CleanerPayoutOnboardingScreen.tsx` | Cleaner screen that opens the Stripe Express onboarding link in the system browser and reflects the returned account status; shows the payout banner while payouts are not yet enabled and re-checks status on return |
| `components/PaymentStatusBadge.tsx` | Presentational pill that renders a payment/payout/dispute status from an i18n `labelKey`, colored by semantic `tone` (neutral/positive/warning/danger) |
| `components/PayoutOnboardingBanner.tsx` | Presentational banner shown to a Cleaner while payouts are not yet enabled; CTA triggers `onPress` to start Stripe onboarding so held funds can be released |
| `components/DisputeBanner.tsx` | Presentational banner surfaced on `PaymentStatusScreen` while a dispute is open |
| `components/RefundSheet.tsx` | Presentational Host refund control (full/partial) that emits the refund amount in cents; disabled while a request is submitting |
| `__tests__/usePayments.spec.ts` | Unit tests for `usePaymentsStore`: fetch, idempotent full/partial refund, refund error mapping, payout-gate flag, server-authoritative state |

## Conventions

- All monetary amounts are integer cents; the UI formats them per locale and the offer's currency (never floating-point money).
- Status values are unions that mirror the backend state machines; the three lifecycles (payment, dispute, payout) are orthogonal.
- No secrets ever cross into the client: `StripeAccountStatus` exposes capability flags only.
- Failed results surface an i18n error key (`RefundResult.errorKey`), not a raw message.
- UI lives in `components/`: presentational, stateless components that render server state and emit callbacks only. They resolve all copy through the `payments` i18n namespace (never hardcoded text) and expose a `testID`.
- Status-to-UI mapping is centralized in pure helpers (`payments.status-map.ts`): components receive a resolved i18n `labelKey` and `tone` rather than switching on raw status values themselves.

## Dependencies

- Backend Stripe Escrow module (`services/api/src/payments`) — the authoritative source for all payment state.
- Shared payment types (`packages/shared/src/types/payment.types.ts`) — the backend/shared breakdown these interfaces mirror.
