# Payments Module

## Purpose
Owns the money lifecycle for a completed service: charging the Host into Stripe escrow, holding funds, and releasing the Cleaner payout (minus commission) on satisfaction, auto-release, or dispute resolution. The module models three orthogonal lifecycles — payment (financial), dispute, and payout — so each can advance independently. All monetary values are integers (cents) and every state change is validated by a pure state machine before it is persisted.

## Files
| File | Responsibility |
|------|---------------|
| `payments.types.ts` | Domain enums (`PaymentStatus`, `DisputeStatus`, `PayoutStatus`, `AttemptStatus`, `ReleaseReason`, `PaymentEventSource`) and view/summary types (`PaymentView`, `PaymentBreakdownView`, `StripeAccountStatus`, `RefundDecision`) |
| `payments.constants.ts` | Env-derived configuration (Stripe keys, Connect settings, escrow timing, BullMQ queue/job options) plus `validatePaymentsConfig()` fail-fast startup validation |
| `payment-state-machine.ts` | Pure state machines: `ALLOWED_TRANSITIONS` maps and `validatePaymentTransition` / `validateDisputeTransition` / `validatePayoutTransition` returning `{ valid, reason? }`, plus `isTerminalPaymentStatus` |
| `payment-payload.sanitizer.ts` | Pure Stripe event payload sanitizer — whitelists only the fields safe to persist in the `payment_events` ledger (ids, amounts, currency, status, timestamps), never card data, secrets, or PII |
| `refund-policy.ts` | Pure refund/reversal policy — decides Host refund vs. proportional Cleaner Transfer reversal from the current payment/payout/dispute state, honoring the refund/reversal ceilings (Property P7) |
| `payments.repository.ts` | `PaymentsRepository` — the module's only data-access layer for `payments`, `payment_attempts`, `stripe_accounts`, and `payment_events`. Runs multi-step mutations under `SELECT ... FOR UPDATE` row locks, validates every status change against the pure state machine before persisting, dedups Stripe events (P8), and never writes the `offers` table |
| `entities/payment.entity.ts` | `payments` table — one payment per offer, with the three status columns, monetary breakdown, and refund/reversal ceilings |
| `entities/payment-attempt.entity.ts` | `payment_attempts` table — charge attempts against a payment (at most one `SUCCEEDED` per payment) |
| `entities/payment-event.entity.ts` | `payment_events` table — audit ledger for API and webhook events, with Stripe event dedup |
| `entities/stripe-account.entity.ts` | `stripe_accounts` table — one Stripe Express connected account per Cleaner |
| `connect/connect-onboarding.service.ts` | `ConnectOnboardingService` — creates or reuses one Express Connected Account per Cleaner, generates the onboarding Account Link (refresh/return URLs), syncs capability flags, and exposes account status without leaking Stripe secrets |
| `connect/connect-reconciliation.service.ts` | `ConnectReconciliationService` — periodic sweep (`CONNECT_RECONCILE_INTERVAL_MS`) that retrieves not-yet-payable accounts (via `idx_stripe_accounts_not_payable`), repairs `charges_enabled` / `payouts_enabled` / `details_submitted`, and triggers deferred payouts for newly-eligible Cleaners; does NOT rely solely on `account.updated` webhooks (P6, P11) |
| `stripe/stripe.client.ts` | Thin injectable wrapper around the Stripe SDK — the module's only seam to Stripe (connected accounts, PaymentIntents, transfers, reversals, refunds, webhook verification). Every mutating call forwards an idempotency key |
| `stripe/stripe-idempotency.ts` | Deterministic idempotency-key builders (`charge`, `release`, `refund`, `reversal`) derived from stable identifiers so replays are no-ops (Property P8) |
| `stripe/stripe-fee.util.ts` | Pure helper (`extractStripeFeeCents`) that reads the Stripe processing fee (integer minor units) from an expanded PaymentIntent's balance transaction, returning `0` when the fee is not yet available for later webhook reconciliation |
| `stripe/stripe.constants.ts` | `STRIPE_WEBHOOK_EVENTS` map and `StripeWebhookEventName` union — the Stripe webhook event names this module dispatches on |
| `events/payment-events.ts` | `PAYMENT_EVENT_NAMES` map, `PaymentEventName` union, and the strongly-typed domain event payloads (`PaymentCapturedEvent`, `PaymentReleasedEvent`, `PaymentFailedEvent`, `PaymentRefundedEvent`, `PaymentDisputedEvent`) emitted via EventEmitter2 for downstream modules to consume — this module never writes another module's tables |

## Lifecycles

The three lifecycles are validated independently (orthogonality). Terminal states have no outgoing transitions.

- **Payment:** `PENDING → PROCESSING → HELD → { RELEASED | REFUNDED | PARTIALLY_REFUNDED }`, with `FAILED` reachable from `PENDING`/`PROCESSING` and retryable. `REFUNDED` is terminal.
- **Dispute:** `NONE → OPEN → { WON | LOST }`.
- **Payout:** `NOT_READY → { PENDING | TRANSFER_CREATED } → PAID → REVERSED`.

State transitions never throw. The pure `validateXxx` functions return a `TransitionResult`; the calling service is responsible for throwing on `{ valid: false }`.

## Domain Events

The module emits typed domain events (EventEmitter2, defined in `events/payment-events.ts`) instead of writing other modules' tables. Consumers react to their own domain:

| Event | Emitted when | Notable consumers |
|-------|--------------|-------------------|
| `payment.captured` | Host charged, funds held in escrow | notifications, analytics |
| `payment.released` | Cleaner payout Transfer created | notifications, analytics |
| `payment.failed` | A charge attempt fails | offer-publishing (decides the offer's next state) |
| `payment.refunded` | A refund (and any reversal) is applied | notifications, dispute-system, analytics |
| `payment.disputed` | A dispute is opened on the payment | dispute-system, notifications |

## Dependencies
- **Offers module** — a payment is created per accepted offer (`offer_id` is unique on `payments`).
- **Domain event consumers** — offer-publishing, notifications, service-tracking, dispute-system, and analytics subscribe to the payment events above; the payments module never writes their tables.
- **Users module** — `host_id` and `cleaner_id` reference users (`ON DELETE RESTRICT`).
- **Infrastructure** — PostgreSQL (TypeORM entities), Redis + BullMQ (webhook processing and deferred release queues).
- **External** — Stripe Connect (escrow charges, transfers, connected accounts, webhooks, and periodic connected-account reconciliation).

## Environment Variables
| Variable | Description | Required |
|----------|-------------|----------|
| `STRIPE_SECRET_KEY` | Stripe server-side secret key | Yes (non-test) |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key for the mobile SDK | No |
| `STRIPE_WEBHOOK_SECRET` | Signing secret to verify Stripe webhook signatures | Yes (non-test) |
| `STRIPE_API_VERSION` | Pinned Stripe API version (default `2024-06-20`) | No |
| `STRIPE_CONNECT_ACCOUNT_TYPE` | Connected account type, must be `express` | No |
| `STRIPE_WEBHOOK_TOLERANCE_SECONDS` | Max accepted webhook age, replay guard (default `300`) | No |
| `STRIPE_ONBOARDING_REFRESH_URL` | Express onboarding Account Link refresh URL | Yes (Connect enabled) |
| `STRIPE_ONBOARDING_RETURN_URL` | Express onboarding Account Link return URL | Yes (Connect enabled) |
| `ESCROW_AUTO_RELEASE_HOURS` | Hours funds are held before auto-release (default `24`) | No |
| `PAYMENTS_AUTO_RELEASE_SWEEP_MS` | Auto-release sweep interval in ms (default `300000`) | No |
| `PAYMENTS_RECONCILE_INTERVAL_MS` | Payment reconciliation interval in ms (default `600000`) | No |
| `CONNECT_RECONCILE_INTERVAL_MS` | Connected-account reconciliation interval in ms (default `900000`) | No |
| `PAYMENTS_MAX_RETRIES` | Max BullMQ job retries (default `5`) | No |
| `PAYMENTS_BACKOFF_DELAY_MS` | BullMQ retry backoff base delay in ms (default `5000`) | No |

Configuration is validated at startup by `validatePaymentsConfig()`, which throws a descriptive error (fail-fast) so a misconfiguration never surfaces mid-payment.

## Related Documentation
- `docs/ARCHITECTURE.md` §5 Payment Flow, §5b Payment Escrow Schema
- `docs/ADR/005-stripe-connect-escrow.md`
