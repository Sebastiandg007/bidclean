# Requirements Document

## Introduction

The stripe-escrow system is where money moves. After `offer-negotiation` finalizes a match (ACTIVE → MATCHED), a Host has committed to a price and a Cleaner is locked in. This module charges the Host immediately, holds the funds in platform-managed escrow, and releases the Cleaner's payout to their Stripe Connected Account only when the service is confirmed complete (by the Host) or auto-released after a configured window.

The design follows the **separate charges and transfers** model recommended by Stripe for marketplaces: the platform charges the Host's card (funds land on the platform's Stripe balance = the escrow), and later creates a Transfer to the Cleaner's Connected Account for the payout, keeping the platform commission. This avoids the ~7-day limit of manual card authorizations, so a service scheduled weeks out is never at risk.

Cleaners onboard to Stripe via **Express Connected Accounts** — Stripe hosts the KYC/onboarding, payout dashboard, and per-country compliance. A Cleaner may win a match before completing Stripe onboarding: the Host is still charged (the sale is never lost), and the payout is held until the Cleaner's account reaches `payouts_enabled`.

This module owns the **payment lifecycle** (charge, hold, release, refund) and the **Stripe integration** (PaymentIntents, Transfers, Connected Accounts, webhooks). It does NOT own the offer lifecycle (owned by `offer-publishing`), the negotiation/match decision (owned by `offer-negotiation`), commission math (owned by `offer-publishing`'s `CommissionService`, which this module reuses), service tracking/completion (owned by `service-tracking` / `service-completion`), or the formal dispute workflow (owned by `dispute-system`; this module only exposes refund primitives and reacts to Stripe chargebacks).

## Domain Model Overview

```
OFFER (owned by offer-publishing — referenced by ID only)
   │  offer.matched { offerId, hostId, cleanerId, matchSource }
   ▼
PAYMENT   (one per matched offer — the escrow aggregate)
   │  THREE orthogonal lifecycles (never collapsed into one status):
   │    payment_status : PENDING → PROCESSING → HELD → RELEASED (↔ REFUNDED / PARTIALLY_REFUNDED)   FAILED
   │    dispute_status : NONE → OPEN → WON | LOST
   │    payout_status  : NOT_READY → PENDING → TRANSFER_CREATED → PAID (→ REVERSED)
   ├── 1:N ── PAYMENT_ATTEMPT   (one per Stripe PaymentIntent; retries add attempts, never mutate the payment row's ids)
   └── 1:N ── PAYMENT_EVENT     (append-only internal ledger + idempotency of every Stripe interaction & webhook)

STRIPE_ACCOUNT   (one per Cleaner — Express Connected Account; payouts_enabled gate)
```

- **Payment** is the escrow aggregate: one row per matched offer, holding the money breakdown (from `CommissionService`), the currency, and three independent statuses. A payment can be `RELEASED` while a dispute is `OPEN` and the payout is `PAID` — a real state that a single collapsed enum could not express.
- **PaymentAttempt** is one Stripe PaymentIntent (charge attempt). A charge retry after a `FAILED` attempt creates a new attempt rather than mutating shared Stripe ids, giving a clean financial history. At most one attempt per payment may be `SUCCEEDED`.
- **StripeAccount** tracks each Cleaner's Express Connected Account and its capability flags (`charges_enabled`, `payouts_enabled`, `details_submitted`), refreshed by both `account.updated` webhooks and a periodic account reconciliation.
- **PaymentEvent** is the append-only internal ledger: every Stripe API result and every processed webhook is recorded (with the idempotency key used), giving a full audit trail and enabling idempotent webhook processing. The persisted payload is sanitized (no card data, no client secrets, no unnecessary PII).
- All money is stored and computed as integer minor units (cents), reusing the offer's snapshotted commission breakdown. `platform_gross_revenue = host_total − cleaner_payout`; `net_platform_revenue = gross − stripe_fee − adjustments`. No floating-point currency math anywhere.

> **"Escrow" precision:** BidClean's escrow is a business concept implemented via Stripe's *Separate Charges and Transfers* model (funds on the platform balance + delayed Transfer). It is NOT a Stripe "Escrow" product nor a legally segregated escrow bank account.

## Glossary

| Term | Definition |
|------|-----------|
| Host | Registered user with the Host role who owns the offer and pays for the service |
| Cleaner | Registered user with the Cleaner role who performs the service and receives the payout |
| Escrow | Funds charged from the Host and held on the platform's Stripe balance until release |
| Payment | The escrow record for a single matched offer (charge + hold + release/refund lifecycle) |
| PaymentIntent | The Stripe object representing the charge against the Host's payment method |
| Transfer | The Stripe object that moves the payout from the platform balance to the Cleaner's Connected Account |
| Connected Account | A Stripe Express account owned by a Cleaner, used to receive payouts |
| Platform Account | The BidClean Stripe account that holds escrow funds and keeps commission |
| Separate Charges and Transfers | The Stripe marketplace model: charge on the platform, transfer to the connectee later |
| Payout Gate | The condition (`payouts_enabled = true`) a Cleaner's Connected Account must satisfy before a Transfer can be created |
| Auto-Release | Automatic escrow release to the Cleaner after a configured window if the Host neither confirms nor disputes |
| Commission | The platform's 13% fee (10% Host service fee + 3% Cleaner commission), computed by the reused `CommissionService` |
| Cleaner Payout | The amount transferred to the Cleaner = agreed price − Cleaner commission |
| Host Total | The amount charged to the Host = agreed price + Host service fee |
| Platform Gross Revenue | Host Total − Cleaner Payout (before Stripe fees) |
| Net Platform Revenue | Platform Gross Revenue − Stripe fees − adjustments (refunds/reversals absorbed) |
| PaymentAttempt | One Stripe PaymentIntent for a Payment; retries add attempts (at most one SUCCEEDED per Payment) |
| Transfer Reversal | A Stripe operation that recovers funds from a Cleaner's Connected Account after a Transfer (used for post-release refunds and lost disputes) |
| Dispute Status | The orthogonal chargeback lifecycle of a Payment: NONE, OPEN, WON, LOST |
| Payout Status | The orthogonal payout lifecycle of a Payment: NOT_READY, PENDING, TRANSFER_CREATED, PAID, REVERSED |
| Idempotency Key | A client- or server-generated key ensuring a Stripe operation runs at most once |
| Webhook | A Stripe-originated HTTP callback notifying the platform of an event (charge succeeded, transfer paid, dispute created, account updated) |
| PaymentEvent | An append-only record of a Stripe interaction or processed webhook (audit + idempotency) |
| Payments (module) | The NestJS backend module responsible for the escrow lifecycle and Stripe integration |
| Mobile_App | The React Native mobile application used by Hosts and Cleaners |

## State Machines (three orthogonal lifecycles)

The design tracks three independent statuses on a Payment. Full diagrams and allowed-transition tables live in `design.md`; the summary:

```
payment_status (financial):
   PENDING → PROCESSING → HELD → RELEASED
                  │          │  ↘ REFUNDED / PARTIALLY_REFUNDED (pre- or post-release)
                  └ FAILED ──┘  (FAILED → PROCESSING allowed: retry via a new PaymentAttempt)
   Terminal: REFUNDED (full).

dispute_status (orthogonal):
   NONE → OPEN → WON | LOST
   While OPEN, auto-release is paused. A LOST dispute after payout may require a Transfer Reversal.

payout_status (orthogonal):
   NOT_READY → PENDING → TRANSFER_CREATED → PAID (→ REVERSED)
   PENDING = release requested but Cleaner not yet payouts_enabled (deferred).
```

- Statuses map to `packages/shared/src/types/payment.types.ts` (business `held_in_escrow` == `HELD`); the shared type is extended (backward-compatibly) with the in-flight states.
- `payment_status`, `dispute_status`, and `payout_status` transition **independently**. A combined state like `RELEASED + OPEN + PAID` is valid and expected.
- A charge retry after `FAILED` creates a NEW `PaymentAttempt` (a new Stripe PaymentIntent); the payment row's ids are never mutated in place.
- The authoritative source of truth is persisted state reconciled against Stripe (via webhooks + retrieval + reconciliation sweeps), never the client.

## Requirements

### Requirement 1: Cleaner Stripe Connect Onboarding

**User Story:** As a Cleaner, I want to connect my bank/payout details through Stripe, so that I can receive payouts for completed services.

#### Acceptance Criteria

1. WHEN a Cleaner requests to start payout onboarding, THE Payments module SHALL create (or reuse) a Stripe Express Connected Account for that Cleaner and persist its account id.
2. WHEN a Connected Account exists for a Cleaner, THE Payments module SHALL generate a Stripe Account Link (onboarding URL) and return it for the Mobile_App to open in the system browser.
3. THE Payments module SHALL NOT create more than one Connected Account per Cleaner; repeated onboarding requests SHALL reuse the existing account.
4. WHEN Stripe reports an `account.updated` event, OR when the periodic Connected Account reconciliation runs, THE Payments module SHALL persist the account's `charges_enabled`, `payouts_enabled`, and `details_submitted` capability flags (not relying solely on webhooks).
5. WHEN a Cleaner requests their payout account status, THE Payments module SHALL return the current capability flags without exposing Stripe secret data.
6. THE Payments module SHALL treat a Cleaner as payout-eligible only WHEN their Connected Account has `payouts_enabled = true`.
7. THE Payments module SHALL require the JWT-authenticated user to hold the Cleaner role for all onboarding endpoints.

### Requirement 2: Escrow Charge on Match

**User Story:** As a Host, I want to be charged the moment my offer is matched, so that the Cleaner is guaranteed payment and I have committed to the job.

#### Acceptance Criteria

1. WHEN an `offer.matched` domain event is received, THE Payments module SHALL create exactly one Payment record for that offer in `PENDING` status.
2. WHEN creating a Payment, THE Payments module SHALL derive the Host Total, Cleaner Payout, and Platform Revenue from the offer's agreed price using the shared `CommissionService` with integer-only arithmetic.
3. WHEN a Payment is created, THE Payments module SHALL create a Stripe PaymentIntent charging the Host Total against the Host's saved payment method in the offer's currency, using an Idempotency Key derived from the offer id.
4. WHEN the PaymentIntent charge succeeds, THE Payments module SHALL transition the Payment to `HELD_IN_ESCROW` and record the funds as held on the platform balance.
5. IF the PaymentIntent charge fails, THEN THE Payments module SHALL set the current PaymentAttempt to `FAILED` and the Payment `payment_status` to `FAILED`, SHALL NOT transfer any funds, and SHALL emit a `payment.failed` domain event.
6. WHEN a `payment.failed` event is emitted, THE Payments module SHALL NOT decide the offer's next lifecycle state; offer-publishing SHALL own that decision (retry, revert, or a matched-payment-failed sub-state). This cross-module contract SHALL be explicit.
7. WHEN a charge is retried for an offer whose Payment is `FAILED`, THE Payments module SHALL create a NEW PaymentAttempt (a new PaymentIntent) and transition `payment_status` `FAILED → PROCESSING`, never mutating a prior attempt's Stripe ids.
8. THE Payments module SHALL NOT produce more than one Payment per offer, and SHALL NOT have more than one `SUCCEEDED` PaymentAttempt per Payment (idempotent on offer id via a unique constraint).
9. WHILE a Payment is `HELD`, THE Payments module SHALL NOT have created any Transfer to the Cleaner.
10. THE Payments module SHALL record every PaymentIntent interaction as an append-only PaymentEvent, including the idempotency key used.
11. WHEN a charge is captured, THE Payments module SHALL record the Stripe processing fee and compute `net_platform_revenue = platform_gross_revenue − stripe_fee`.

### Requirement 3: Escrow Release to Cleaner

**User Story:** As a Cleaner, I want to receive my payout once the service is confirmed, so that I am paid for my work.

#### Acceptance Criteria

1. WHEN the Host confirms service completion for a matched offer, THE Payments module SHALL release the escrow by creating a Stripe Transfer of the Cleaner Payout to the Cleaner's Connected Account.
2. WHERE the Cleaner's Connected Account is not yet `payouts_enabled`, THE Payments module SHALL mark the payout as pending release and SHALL NOT create the Transfer until the account becomes payout-eligible.
3. WHEN a Cleaner's Connected Account becomes `payouts_enabled` (via `account.updated` webhook OR the periodic account reconciliation) AND a payout is pending release for that Cleaner, THE Payments module SHALL create the deferred Transfer.
4. WHEN no confirmation and no dispute occur within the configured Auto-Release window after the escrow is held, THE Payments module SHALL automatically release the escrow to the Cleaner.
5. WHEN a Transfer succeeds, THE Payments module SHALL transition the Payment to `RELEASED` and record the transferred amount and Stripe transfer id.
6. THE Payments module SHALL create at most one successful release Transfer per Payment (idempotent on payment id).
7. THE Payments module SHALL only release a Payment that is in `HELD_IN_ESCROW` (or `PARTIALLY_REFUNDED` for the remaining amount); releasing any other status SHALL be rejected with a conflict.
8. THE Payments module SHALL keep the Platform Revenue (commission) on the platform balance and transfer only the Cleaner Payout.

### Requirement 4: Refunds and Transfer Reversal

**User Story:** As a Host, I want to be refunded when a service does not happen or is unsatisfactory — whether or not the Cleaner has already been paid — so that I am not charged for work I did not receive, and the money is recovered correctly.

#### Acceptance Criteria

1. WHEN a full refund is requested for a Payment that is `HELD` or `PARTIALLY_REFUNDED` (pre-release), THE Payments module SHALL create a Stripe Refund of the remaining refundable amount to the Host and transition `payment_status` to `REFUNDED`, with no Transfer Reversal (funds are still on the platform balance).
2. WHEN a partial refund is requested pre-release, THE Payments module SHALL create a Stripe Refund of the requested amount (a positive integer not exceeding the remaining refundable balance) and transition `payment_status` to `PARTIALLY_REFUNDED`.
3. THE Payments module SHALL reject a refund whose amount exceeds the remaining refundable balance (`host_total − refunded_amount`) with a validation error.
4. WHEN a refund is requested for a Payment that is already `RELEASED` (payout `TRANSFER_CREATED` or `PAID`), THE Payments module SHALL, per the Post-Release Refund & Transfer Reversal Policy, create a Stripe Transfer Reversal recovering the Cleaner's proportional share (not exceeding `cleaner_payout`) AND a Stripe Refund to the Host, then update `refunded_amount`, `reversed_amount`, and `net_platform_revenue`.
5. THE Payments module SHALL reject a Transfer Reversal whose cumulative amount would exceed `cleaner_payout_cents` with a validation error.
6. THE Payments module SHALL absorb the Stripe processing fee on refunds (reducing `net_platform_revenue`) and SHALL NOT charge that fee back to the Cleaner; the platform commission share is refunded from the platform balance.
7. WHILE a Payment's `dispute_status` is `OPEN`, THE Payments module SHALL reject manual refund requests with a conflict, because the dispute workflow governs the funds.
8. WHEN a refund or reversal succeeds, THE Payments module SHALL record the amounts and Stripe ids as PaymentEvents.
9. THE Payments module SHALL make refund and reversal operations idempotent per Idempotency Key so client or webhook retries never double-refund or double-reverse.

### Requirement 5: Stripe Webhook Ingestion

**User Story:** As the platform, I want to reliably process Stripe events, so that payment state stays consistent even when synchronous API calls are interrupted.

#### Acceptance Criteria

1. WHEN a Stripe webhook is received, THE Payments module SHALL verify the request signature against the configured webhook signing secret before any processing.
2. IF the webhook signature is invalid or missing, THEN THE Payments module SHALL reject the request with `400 Bad Request` and SHALL NOT process the event.
3. WHEN a webhook signature is valid, THE Payments module SHALL acknowledge receipt promptly (2xx) and process the event asynchronously via a durable queue.
4. THE Payments module SHALL process each Stripe event at most once by de-duplicating on the Stripe event id recorded in PaymentEvent.
5. THE Payments module SHALL reject webhook events older than the configured tolerance window (replay guard) even when the signature format is otherwise valid.
6. THE Payments module SHALL handle at least: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `transfer.created`/`transfer.paid`, `transfer.reversed`, `charge.dispute.created`, `charge.dispute.closed` (won/lost), and `account.updated`.
7. WHEN a `charge.dispute.created` event is received, THE Payments module SHALL set the Payment's `dispute_status` to `OPEN` (independent of `payment_status`), SHALL pause auto-release for that Payment, and SHALL emit `payment.disputed`.
8. WHEN a dispute-closed event resolves as won or lost, THE Payments module SHALL set `dispute_status` to `WON` or `LOST` respectively; a `LOST` dispute after payout MAY require a Transfer Reversal, coordinated by the dispute-system module using this module's reversal primitive.
9. WHEN an `account.updated` event reports capability changes, THE Payments module SHALL persist `charges_enabled`, `payouts_enabled`, `details_submitted`, and SHALL trigger any deferred payout for a newly payout-eligible Cleaner.
10. WHERE asynchronous webhook processing fails transiently, THE Payments module SHALL retry with backoff and route exhausted events to a dead-letter path for inspection without losing the event.
11. THE Payments module SHALL treat persisted state reconciled with Stripe as authoritative; a failed synchronous call never leaves an unrecoverable state because the corresponding webhook and reconciliation sweeps reconcile it.

### Requirement 6: Money Integrity and Breakdown Consistency

**User Story:** As a Host and as a Cleaner, I want the amounts I am charged and paid to be exact and consistent, so that I trust the platform with money.

#### Acceptance Criteria

1. THE Payments module SHALL represent every monetary value as an integer count of the currency's minor unit (cents), never a floating-point number.
2. THE Payments module SHALL reuse the offer-publishing `CommissionService` for all fee and payout math and SHALL NOT implement an independent commission or rounding algorithm.
3. THE Payments module SHALL persist, on the Payment, the Host Total, Cleaner Payout, and Platform Revenue derived from the offer's agreed price and snapshotted commission rates.
4. THE Payments module SHALL guarantee that Host Total = agreed price + Host service fee, and Cleaner Payout = agreed price − Cleaner commission, for every Payment.
5. THE Payments module SHALL transfer to the Cleaner exactly the persisted Cleaner Payout amount (subject to pending-release deferral), never a recomputed value.
6. THE Payments module SHALL denominate every Stripe operation in the offer's currency and SHALL support COP, USD, CAD, EUR, and GBP.

### Requirement 7: Payment Status Visibility

**User Story:** As a Host or Cleaner, I want to see the status of a payment for an offer, so that I know whether I have been charged, held, released, or refunded.

#### Acceptance Criteria

1. WHEN a Host requests the payment for one of their offers, THE Payments module SHALL return the Payment status and the Host-facing breakdown (Host Total, currency, status, timestamps).
2. WHEN a Cleaner requests the payment for an offer they matched, THE Payments module SHALL return the Payment status and the Cleaner-facing breakdown (Cleaner Payout, currency, status, pending-release flag).
3. THE Payments module SHALL reject a payment status request from a user who is neither the Host owner nor the matched Cleaner of that offer with a forbidden error.
4. THE Payments module SHALL NOT expose the counterparty's private financial data or any Stripe secret identifiers in status responses.
5. THE Payments module SHALL require JWT authentication on all payment status endpoints.

### Requirement 8: Mobile Payment & Onboarding UI

**User Story:** As a Host and as a Cleaner, I want clear screens to add a payment method, complete payout onboarding, and see payment status, so that paying and getting paid is simple.

#### Acceptance Criteria

1. THE Mobile_App SHALL present the Host a screen to add or confirm a payment method using Stripe's SDK, never touching raw card data.
2. THE Mobile_App SHALL present the Cleaner a payout onboarding entry point that opens the Stripe Express onboarding link in the system browser and reflects the returned account status.
3. WHILE a Cleaner's payout account is not `payouts_enabled`, THE Mobile_App SHALL communicate that payouts are pending onboarding completion.
4. THE Mobile_App SHALL show the payment status for a matched offer (charged / held / released / refunded) with locale-formatted amounts in the offer currency.
5. THE Mobile_App SHALL localize all payment UI text via i18n keys and SHALL NOT hardcode user-facing strings.
6. THE Mobile_App SHALL NOT perform any authoritative payment decision; it SHALL rely entirely on the Payments backend state.

## Non-Functional Requirements

### Correctness Properties

- **P1 — Money integrity:** Every monetary value is an integer minor unit computed via `CommissionService`; no floating-point currency math exists in the module.
- **P2 — Breakdown consistency:** A Payment's persisted Host Total, Cleaner Payout, and Platform Revenue exactly equal the `CommissionService` breakdown for the agreed price and snapshotted rates.
- **P3 — Single charge per offer:** An offer never produces more than one non-`FAILED` Payment.
- **P4 — Single release per payment:** A Payment never produces more than one successful release Transfer.
- **P5 — Escrow safety:** No funds are transferred to a Cleaner while a Payment is `HELD` and neither confirmed nor auto-released; auto-release never runs while `dispute_status = OPEN`.
- **P6 — Payout gate:** A Transfer is never created for a Cleaner whose Connected Account is not `payouts_enabled`; a deferred payout is created once the account becomes eligible (via webhook or account reconciliation).
- **P7 — Refund & reversal ceilings:** The sum of refunded amounts never exceeds Host Total; the sum of Transfer Reversals never exceeds Cleaner Payout.
- **P8 — Idempotency:** Any Stripe-mutating operation replayed with the same Idempotency Key (or any webhook redelivered with the same event id) produces the same result and never double-charges, double-refunds, double-transfers, or double-reverses.
- **P9 — Webhook authenticity:** No webhook is processed unless its Stripe signature verifies against the configured secret AND falls within the tolerance (replay) window.
- **P10 — Authorization:** Only the Host owner or the matched Cleaner can read a payment; only the Cleaner can onboard their own payout account.
- **P11 — Reconciliation convergence:** For any interrupted synchronous flow, the corresponding Stripe webhook and the reconciliation sweeps (payments AND connected accounts) converge the persisted state to Stripe's truth.
- **P12 — Lifecycle orthogonality:** `payment_status`, `dispute_status`, and `payout_status` transition only via their own allowed transitions and independently of each other; a dispute never illegally mutates the financial status, and a combined state such as `RELEASED + OPEN + PAID` is valid.

### Security
- All payment and onboarding endpoints require JWT authentication; role checks enforce Host-only and Cleaner-only actions.
- The platform never receives or stores raw card data; all card handling is delegated to Stripe's SDK/Elements (PCI SAQ-A scope).
- Stripe secret keys and webhook secrets are read only from environment variables, never hardcoded and never returned in any response.
- Webhook endpoints verify the Stripe signature before processing and are the only unauthenticated route (authenticated by signature instead of JWT).
- All Stripe secret identifiers (customer ids, account ids, intent ids) are treated as internal and excluded from client-facing responses except where required for the Stripe SDK on device.

### Performance
- Webhook endpoints acknowledge within 1 second by deferring heavy processing to the queue.
- Escrow charge on match is initiated within 2 seconds of receiving `offer.matched` under normal load.

### Reliability
- Stripe interactions use idempotency keys; retries never double-process.
- Webhook processing is durable (queued) with retry, backoff, and a dead-letter path; no event is silently dropped.
- Persisted state reconciled with Stripe is authoritative; synchronous failures are always recoverable via webhooks and a periodic reconciliation sweep.

### Internationalization
- All payment UI text uses i18n keys (no hardcoded strings).
- Amounts display in the offer currency, formatted per user locale (COP, USD, CAD, EUR, GBP).

### Configuration
- All Stripe keys, the webhook secret, the webhook tolerance (replay) window, the Auto-Release window, retry/backoff, the payment reconciliation interval, and the connected-account reconciliation interval come from environment variables, validated at startup (fail-fast).

### Auditability
- Every Stripe interaction and processed webhook is recorded in the append-only internal ledger (`payment_events`) with the idempotency key used, enabling full reconstruction of Payment → Stripe request → response.
- The persisted event payload is sanitized: it NEVER contains card data, `client_secret`, payment-method secrets, or unnecessary PII.

## Dependencies

- **offer-negotiation (Spec 8) / offer-publishing (Spec 6):** the `offer.matched` domain event (`{ offerId, hostId, cleanerId, matchSource }`) that triggers the escrow charge, and the `CommissionService` for all money math.
- **user-roles (Spec 2):** Host and Cleaner role enforcement.
- **kyc-verification (Spec 3):** the Cleaner's platform KYC is separate from Stripe's Connected Account KYC; both must be satisfied for full participation.
- **Stripe Connect:** Express Connected Accounts, PaymentIntents, Transfers, Refunds, and webhooks.
- **BullMQ (Redis):** durable asynchronous webhook processing and deferred/scheduled release jobs.

## Out of Scope

- The offer lifecycle and the ACTIVE → MATCHED transition (owned by offer-publishing / offer-negotiation).
- Commission rate definition and calculation algorithm (owned by offer-publishing's `CommissionService`; reused here).
- Service tracking, check-in, photos, and the completion signal itself (owned by service-tracking / service-completion; this module consumes the confirmation to trigger release).
- The formal dispute resolution workflow and evidence submission (owned by dispute-system). This module tracks `dispute_status` (NONE/OPEN/WON/LOST) from Stripe chargeback webhooks, pauses auto-release while OPEN, and exposes the Refund and Transfer Reversal primitives that dispute-system consumes to recover funds on a LOST dispute.
- Subscriptions, ads, and corporate funnels (owned by the RevenueCat specs).
- Cleaner tier/PRO logic and its effect on commission (owned by offer-publishing / subscription specs).
