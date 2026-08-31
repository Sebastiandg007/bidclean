# Implementation Plan: Stripe Escrow

## Overview

Stripe Escrow moves money for a matched offer using Stripe Connect (Express) and the separate charges and transfers model: charge the Host on match, hold funds on the platform balance (business "escrow"), and Transfer the payout to the Cleaner's Connected Account on confirmation / auto-release. Implementation is bottom-up: shared types + DB schema first, then constants + the three pure state machines + the refund policy, then the injectable StripeClient seam, then the repository, then the domain services, then the controller + webhook controller, then the async processor + listeners + workers, and finally the mobile store, screens, and property/integration tests.

The module lives in its own PaymentsModule importing OffersModule to reuse CommissionService, and subscribing to offer.matched via EventEmitter2. It NEVER writes the offers table and NEVER decides the offer's next state; it emits payment.* events. All money is integer minor units via CommissionService; all Stripe-mutating operations are idempotent; the three lifecycles (payment_status, dispute_status, payout_status) are independent; every Stripe interaction is recorded in the sanitized append-only payment_events ledger.

## Tasks

- [x] 1. Shared types alignment & environment configuration
  - [x] 1.1 Extend shared payment types (backward-compatible)
    - Update `packages/shared/src/types/payment.types.ts`: keep existing `PaymentStatus` business values; add optional `stripeFeeAmount` and `netPlatformRevenue` to `PaymentBreakdown`
    - Do NOT break existing consumers; additions only
    - _Requirements: 6.1, 6.3_
  - [x] 1.2 Add Stripe/escrow environment variables to `.env.example`
    - Add `STRIPE_API_VERSION`, `STRIPE_CONNECT_ACCOUNT_TYPE`, `STRIPE_WEBHOOK_TOLERANCE_SECONDS`, `STRIPE_ONBOARDING_REFRESH_URL`, `STRIPE_ONBOARDING_RETURN_URL`, `ESCROW_AUTO_RELEASE_HOURS`, `PAYMENTS_AUTO_RELEASE_SWEEP_MS`, `PAYMENTS_RECONCILE_INTERVAL_MS`, `CONNECT_RECONCILE_INTERVAL_MS`, `PAYMENTS_MAX_RETRIES`, `PAYMENTS_BACKOFF_DELAY_MS`
    - `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` already exist — do not duplicate
    - _Requirements: 6.6, 5.5_

- [x] 2. Backend — Database Schema & Migration
  - [x] 2.1 Create the payments migration
    - Create `services/api/src/migrations/1700000014000-CreatePaymentTables.ts` implementing `MigrationInterface` with `up()`/`down()`
    - Table `payments`: id UUID PK, offer_id (FK offers RESTRICT), host_id/cleaner_id (FK users RESTRICT), `payment_status` VARCHAR(20) DEFAULT PENDING, `dispute_status` VARCHAR(10) DEFAULT NONE, `payout_status` VARCHAR(20) DEFAULT NOT_READY, currency CHAR(3), money columns (agreed_price_cents, host_total_cents, cleaner_payout_cents, platform_gross_revenue_cents, stripe_fee_cents, net_platform_revenue_cents, refunded_amount_cents, reversed_amount_cents), stripe_transfer_id, held_at/released_at, created_at/updated_at
    - Constraints: `uq_payment_offer UNIQUE (offer_id)` (P3), `chk_payment_status`, `chk_dispute_status`, `chk_payout_status`, `chk_amounts_positive`, `chk_refund_ceiling` (P7), `chk_reversal_ceiling` (P7 companion)
    - Indexes: host, cleaner, payment_status, partial `idx_payments_dispute` WHERE dispute_status <> NONE, partial `idx_payments_auto_release (held_at) WHERE payment_status='HELD' AND dispute_status='NONE'`, partial `idx_payments_pending_payout (cleaner_id) WHERE payout_status='PENDING'`
    - Table `payment_attempts`: id UUID PK, payment_id (FK CASCADE), attempt_number INTEGER, stripe_payment_intent_id, stripe_charge_id nullable, status VARCHAR(12) DEFAULT PROCESSING, failure_reason TEXT, amount_cents, currency, timestamps; `uq_attempt_payment_number`, `uq_attempt_intent`, `chk_attempt_status`; partial unique `uq_one_succeeded_attempt (payment_id) WHERE status='SUCCEEDED'`
    - Table `stripe_accounts`: id UUID PK, cleaner_id (FK CASCADE), stripe_account_id, charges_enabled/payouts_enabled/details_submitted BOOLEAN, country CHAR(2), default_currency CHAR(3), last_synced_at, timestamps; `uq_stripe_account_cleaner`, `uq_stripe_account_id`, partial `idx_stripe_accounts_not_payable (last_synced_at) WHERE payouts_enabled=FALSE`
    - Table `payment_events`: id UUID PK, payment_id (FK CASCADE, nullable), source VARCHAR(20), event_type VARCHAR(80), stripe_event_id, idempotency_key, amount_cents, currency, payload_json JSONB, created_at; `chk_payment_event_source`, partial unique `uq_payment_event_stripe_id WHERE stripe_event_id IS NOT NULL` (P8), indexes on payment_id, event_type, partial on idempotency_key
    - `down()` drops indexes then tables in reverse dependency order
    - _Requirements: 2.8, 3.6, 4.3, 4.5, 5.4, 6.3_

- [x] 3. Backend — Types, Constants, State Machines & Refund Policy
  - [x] 3.1 Create payments types and enums
    - Create `services/api/src/payments/payments.types.ts` with enums `PaymentStatus` (PENDING, PROCESSING, HELD, RELEASED, REFUNDED, PARTIALLY_REFUNDED, FAILED), `DisputeStatus` (NONE, OPEN, WON, LOST), `PayoutStatus` (NOT_READY, PENDING, TRANSFER_CREATED, PAID, REVERSED), `AttemptStatus` (PROCESSING, SUCCEEDED, FAILED), `ReleaseReason` (HOST_CONFIRMED, AUTO_RELEASE, DEFERRED_ONBOARDING)
    - Add internal view/summary types: `PaymentView` (payment+dispute+payout+breakdown), `StripeAccountStatus`, `RefundDecision`
    - _Requirements: 5.7, 7.1, 7.2_
  - [x] 3.2 Create payments constants with startup validation
    - Create `services/api/src/payments/payments.constants.ts` with all env-configurable values (Stripe keys/version/account-type/tolerance/onboarding URLs, `ESCROW_AUTO_RELEASE_HOURS`, sweep/reconcile intervals, retries/backoff, `PAYMENTS_QUEUE_NAMES`, `SUPPORTED_CURRENCIES`)
    - Implement `validatePaymentsConfig()` fail-fast: secret/webhook non-empty in non-test env; account type === 'express'; tolerance > 0; auto-release hours > 0; all intervals/backoff > 0; max retries > 0; onboarding URLs present when Connect enabled
    - No hardcoded business values in logic
    - _Requirements: 6.6, 5.5, 3.4_
  - [x] 3.3 Implement the three pure state machines
    - Create `services/api/src/payments/payment-state-machine.ts` with `PAYMENT_ALLOWED_TRANSITIONS` (incl. FAILED to PROCESSING retry and RELEASED to REFUNDED/PARTIALLY_REFUNDED post-release), `DISPUTE_ALLOWED_TRANSITIONS`, `PAYOUT_ALLOWED_TRANSITIONS`, and pure `validatePaymentTransition` / `validateDisputeTransition` / `validatePayoutTransition`
    - _Requirements: 5.7, 5.8_
  - [x] 3.4 Implement the refund/reversal policy (pure)
    - Create `services/api/src/payments/refund-policy.ts`: `decideRefund(paymentStatus, payoutStatus, disputeStatus, requestedAmount, hostTotal, refunded, cleanerPayout, reversed)` returning `{ refundAmount, reversalAmount, blocked, reason }` per the Post-Release Refund & Transfer Reversal Policy (pre-release = Refund only; post-release = Refund + proportional Reversal; DISPUTED OPEN = blocked; enforces refund ceiling = host_total and reversal ceiling = cleaner_payout; Stripe fee absorbed by platform)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_
  - [x]* 3.5 Write unit tests for state machines and refund policy
    - Test allowed/blocked transitions for all three lifecycles (Property P12); terminal `REFUNDED`
    - Test `refund-policy` apportionment: pre-release refund only; post-release refund+reversal; ceilings; disputed-open blocked; fee absorption arithmetic (Property P7)
    - _Requirements: 4.3, 4.7, 5.7_

- [x] 4. Backend — Stripe Client Seam
  - [x] 4.1 Implement StripeClient wrapper
    - Add `stripe` dependency (pinned). Create `services/api/src/payments/stripe/stripe.client.ts` initializing the SDK from `STRIPE_SECRET_KEY` + pinned `STRIPE_API_VERSION`
    - Methods: `createConnectedAccount`, `createAccountLink`, `retrieveAccount`, `createPaymentIntent(params, idemKey)`, `retrievePaymentIntent`, `createTransfer(params, idemKey)`, `createTransferReversal(transferId, params, idemKey)`, `createRefund(params, idemKey)`, `constructWebhookEvent(rawBody, signature)` (signature verify with tolerance window, throws on invalid/old)
    - Create `stripe/stripe.constants.ts` (API version, webhook event name constants) and `stripe/stripe-idempotency.ts` (`charge:{offerId}:{n}`, `release:{paymentId}`, `refund:{paymentId}:{key}`, `reversal:{paymentId}:{key}`)
    - The rest of the module NEVER imports `stripe` directly — only through this seam (testability)
    - _Requirements: 5.1, 5.2, 5.5, 8.1_
  - [x]* 4.2 Write unit tests for StripeClient (mocked SDK)
    - Test idempotency keys are passed through; webhook signature verification accepts valid + within-tolerance, rejects invalid + too-old (Property P9)
    - _Requirements: 5.1, 5.2_

- [x] 5. Backend — Repository & Sanitizer
  - [x] 5.1 Implement payment event payload sanitizer
    - Create a pure `sanitizeStripePayload(event)` that whitelists ONLY: event id, type, object id, amounts, currency, status, Stripe timestamps; NEVER card data, `client_secret`, PM secrets, or unnecessary PII
    - _Requirements: 5.4_
  - [x] 5.2 Implement PaymentsRepository
    - Create `services/api/src/payments/payments.repository.ts` with: upsert payment for offer (create PENDING or reuse FAILED row); insert new `payment_attempt` with next attempt_number (`SELECT ... FOR UPDATE` on payment); mark attempt SUCCEEDED/FAILED; transition `payment_status`/`dispute_status`/`payout_status` atomically with validation; record fee + compute net revenue; increment refunded/reversed amounts; append PaymentEvent (with idempotency key + sanitized payload); webhook dedup read by stripe_event_id
    - Stripe account upsert + capability update; find payments pending payout for a cleaner; find held payments past auto-release window (not disputed); find accounts not payout-enabled for reconciliation
    - NEVER writes the `offers` table
    - _Requirements: 2.1, 2.7, 2.8, 3.2, 3.6, 4.8, 5.4_
  - [x]* 5.3 Write unit tests for repository invariants
    - Test one payment per offer + one SUCCEEDED attempt (Property P3); attempt_number strictly increasing; refunded/reversed increments respect ceilings (Property P7); webhook dedup by event id (Property P8)
    - _Requirements: 2.8, 3.6, 4.3_

- [x] 6. Checkpoint — Backend foundation compiles and unit tests pass
  - Ensure shared types, schema, state machines, refund policy, StripeClient, repository compile and their unit tests pass; ask the user if questions arise.

- [x] 7. Backend — Connect Onboarding & Account Sync
  - [x] 7.1 Implement ConnectOnboardingService
    - Create `connect/connect-onboarding.service.ts`: create-or-reuse Express Connected Account per Cleaner (one per cleaner, `uq_stripe_account_cleaner`), generate Account Link (onboarding URL) with refresh/return URLs, sync capability flags, expose account status without leaking Stripe secrets
    - Payout-eligibility = `payouts_enabled === true`
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6_
  - [x] 7.2 Implement ConnectReconciliationService
    - Create `connect/connect-reconciliation.service.ts` running on `CONNECT_RECONCILE_INTERVAL_MS`: for accounts with `payouts_enabled=false` (via `idx_stripe_accounts_not_payable`), retrieve the Stripe account, repair capability flags, and trigger deferred payouts for newly-eligible Cleaners (does NOT rely solely on `account.updated`)
    - _Requirements: 1.4, 3.3_
  - [x]* 7.3 Write unit tests for connect onboarding & reconciliation
    - Test single account per cleaner (reuse); capability sync; reconciliation flips payouts_enabled and triggers deferred release (Property P6)
    - _Requirements: 1.3, 1.4, 3.3_

- [x] 8. Backend — Escrow Charge (on match)
  - [x] 8.1 Implement EscrowChargeService and OfferMatchedListener
    - Create `listeners/offer-matched.listener.ts` (`@OnEvent('offer.matched')`) delegating to `escrow/escrow-charge.service.ts`
    - `chargeForOffer(offer)`: resolve agreed price (negotiation match summary when a thread exists, else `offers.offered_price_cents`); compute breakdown via `CommissionService`; upsert payment (PENDING) + insert attempt; create PaymentIntent (Idempotency-Key `charge:offerId:n`) against Host's payment method in offer currency
    - On success: attempt SUCCEEDED, payment HELD, record `stripe_fee_cents` + `net_platform_revenue_cents`, emit `payment.captured`
    - On failure: attempt FAILED, payment FAILED, emit `payment.failed` (offer module decides offer next state — do NOT touch offers)
    - Idempotent on offer id; retry after FAILED creates a new attempt (FAILED to PROCESSING)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11_
  - [x]* 8.2 Write unit tests for escrow charge
    - Test single charge under concurrent `offer.matched` (Property P3, mocked Stripe); breakdown consistency (Property P2); fee/net revenue recorded; failed charge emits payment.failed and does not transfer; retry creates new attempt
    - _Requirements: 2.1, 2.2, 2.6, 6.3_

- [x] 9. Backend — Escrow Release (confirm / auto / deferred)
  - [x] 9.1 Implement EscrowReleaseService
    - Create `escrow/escrow-release.service.ts` `release(paymentId, reason)`: load payment (must be HELD/PARTIALLY_REFUNDED, dispute_status != OPEN); load cleaner account
    - If `payouts_enabled=false`: set `payout_status=PENDING` (defer, no Transfer) [P6]
    - Else: create Transfer (Idempotency-Key `release:paymentId`) of `cleaner_payout_cents` to the Connected Account; set payout_status TRANSFER_CREATED, payment_status RELEASED, persist transfer id; emit `payment.released`
    - At most one successful release per payment (P4); keep platform commission on platform balance
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 3.7, 3.8_
  - [x] 9.2 Implement AutoReleaseWorker
    - Create `release/auto-release.worker.ts` on `PAYMENTS_AUTO_RELEASE_SWEEP_MS`: select HELD, not disputed, `held_at + ESCROW_AUTO_RELEASE_HOURS < NOW()` (via `idx_payments_auto_release`) and call `release(paymentId, AUTO_RELEASE)`
    - _Requirements: 3.4, 5.6_
  - [x]* 9.3 Write unit tests for release + auto-release
    - Test single release under concurrent triggers (Property P4); payout-gate defers when not payouts_enabled (Property P6); auto-release excludes disputed (Property P5); escrow safety
    - _Requirements: 3.2, 3.6, 3.7, 5.6_

- [x] 10. Backend — Refunds, Reversal & Disputes
  - [x] 10.1 Implement RefundService
    - Create `refunds/refund.service.ts` `refund(hostId, offerId, dto, idemKey)`: authorize Host owner; load payment; call `refund-policy.decideRefund(...)`; if blocked (disputed open) return 409; pre-release create Stripe Refund; post-release create Transfer Reversal (`reversal:paymentId:key`) + Stripe Refund (`refund:paymentId:key`); update refunded/reversed amounts + recompute net revenue; emit `payment.refunded`; record PaymentEvents
    - Enforce refund ceiling (422) and reversal ceiling (422); fee absorbed by platform
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_
  - [x] 10.2 Implement DisputeService
    - Create `disputes/dispute.service.ts`: on `charge.dispute.created` set `dispute_status=OPEN`, pause auto-release, emit `payment.disputed`; on dispute-closed set WON/LOST (LOST after payout may require reversal, coordinated by dispute-system via the reversal primitive)
    - Dispute lifecycle is orthogonal to payment_status (P12)
    - _Requirements: 5.6, 5.7, 5.8_
  - [x]* 10.3 Write unit tests for refunds, reversal and disputes
    - Test refund ceiling + reversal ceiling (Property P7); post-release refund creates reversal + refund; disputed-open blocks manual refund; dispute event sets orthogonal status and pauses auto-release (Property P5, P12)
    - _Requirements: 4.3, 4.7, 5.6, 5.7_

- [x] 11. Backend — Controller, Webhooks & DTOs
  - [x] 11.1 Implement PaymentsController
    - Create `payments.controller.ts` class-level `@UseGuards(JwtAuthGuard)`; resolve keycloakId -> User; role checks per endpoint
    - Endpoints: POST `/payments/connect/onboarding` (Cleaner), GET `/payments/connect/status` (Cleaner), GET `/payments/offers/:offerId` (Host owner or matched Cleaner), POST `/payments/offers/:offerId/refund` (Host owner)
    - Payment status response includes payment/dispute/payout status + role-scoped breakdown; never leak counterparty private data or Stripe secret ids; require Idempotency-Key on refund
    - Status codes 200/201/400/401/403/409/422; project uses no Swagger — omit decorators
    - _Requirements: 1.7, 7.1, 7.2, 7.3, 7.4, 7.5_
  - [x] 11.2 Implement StripeWebhookController + DTOs
    - Create `webhooks/stripe-webhook.controller.ts` on a route NOT under JwtAuthGuard; read RAW body; verify signature + tolerance via StripeClient (400 on invalid/old); dedup by event id; persist sanitized PaymentEvent; enqueue on BullMQ; fast 2xx ACK
    - Create `dto/refund.dto.ts` (optional positive integer amountCents; omit = full), `dto/payment-response.dto.ts`, `dto/account-status-response.dto.ts` with class-validator
    - Ensure the raw-body parser is configured for the webhook route only
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 4.2_
  - [x]* 11.3 Write unit tests for controllers
    - Test JWT/role rejection; authorization (only owner/matched read) (Property P10); invalid/old webhook signature returns 400 no mutation (Property P9); refund DTO validation
    - _Requirements: 7.3, 7.5, 5.1, 5.2_

- [x] 12. Backend — Webhook Processor, Reconciliation & Module Wiring
  - [x] 12.1 Implement StripeWebhookProcessor
    - Create `webhooks/stripe-webhook.processor.ts` (BullMQ `@Processor`): dedup on stripe_event_id; dispatch by type — `payment_intent.succeeded`/`payment_intent.payment_failed` (charge), `charge.refunded`, `transfer.created`/`transfer.paid`/`transfer.reversed` (payout status), `charge.dispute.created`/`charge.dispute.closed` (dispute service), `account.updated` (capability sync + deferred payout)
    - Retry with backoff; exhausted route to dead-letter (no event lost)
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 3.3_
  - [x] 12.2 Implement PaymentReconciliationService
    - Create `reconciliation/payment-reconciliation.service.ts` on `PAYMENTS_RECONCILE_INTERVAL_MS`: repair PROCESSING-vs-Stripe intent mismatches; create deferred Transfer when account now eligible; reconcile transfer-exists-but-not-RELEASED; reconcile refunds/reversals present in Stripe but not persisted
    - No distributed transactions; convergence to Stripe truth (Property P11)
    - _Requirements: 5.11, 3.5_
  - [x] 12.3 Wire PaymentsModule
    - Create `payments.module.ts` importing `OffersModule` (reuse `CommissionService`), `EventEmitterModule`, `ScheduleModule`, `BullModule` (register `payments-stripe-webhook`, `payments-deferred-release` queues), `TypeOrmModule.forFeature([Payment, PaymentAttempt, StripeAccount, PaymentEvent, Offer, User])`
    - Register controllers (payments + webhook), services, repository, StripeClient, listener, workers, reconciliation services; call `validatePaymentsConfig()` in `onModuleInit`; register in AppModule
    - _Requirements: 6.2, 6.6_
  - [x]* 12.4 Write unit tests for processor & reconciliation
    - Test webhook dedup + dispatch by type; out-of-order events converge; reconciliation repairs an interrupted charge and a transfer-exists-but-not-released (Property P11); account.updated multiple times is idempotent
    - _Requirements: 5.4, 5.11_

- [x] 13. Checkpoint — Backend payment flows work end-to-end
  - Ensure all backend tests pass; ask the user if questions arise.

- [x] 14. Mobile — Store, Types & API Client
  - [x] 14.1 Create payments types and constants
    - Create `apps/mobile/src/screens/payments/payments.types.ts` (PaymentStatus, DisputeStatus, PayoutStatus, PaymentView, StripeAccountStatus, RefundResult), `payments.constants.ts` (ENDPOINTS, i18n keys, Idempotency header), and `payments.format.ts` (locale + currency money formatting)
    - _Requirements: 8.4, 8.5_
  - [x] 14.2 Implement payments API client
    - Create `payments.api.ts` with lazy `getApiClient()`, `ENDPOINTS`, typed methods: startOnboarding, accountStatus, fetchPayment, requestRefund; attach `Idempotency-Key` via `expo-crypto` on refund
    - _Requirements: 4.9, 7.1, 7.2_
  - [x] 14.3 Implement usePayments Zustand store
    - Create `usePayments.ts` following useNegotiation/useOffers patterns: `paymentByOffer` map, `fetchPayment`, `requestRefund` (omit amount = full), `accountStatus`, `startOnboarding`, `refreshAccountStatus`; i18n error keys; server authoritative (no client payment decisions)
    - _Requirements: 8.4, 8.6_
  - [x]* 14.4 Write unit tests for usePayments
    - Test idempotent refund request; payout-gate flag drives banner; server authoritative (no local decision); refund amount mirror validation
    - _Requirements: 8.3, 8.6_

- [x] 15. Mobile — Payment & Onboarding UI
  - [x] 15.1 Implement HostPaymentMethodScreen
    - Create `HostPaymentMethodScreen.tsx` using `@stripe/stripe-react-native` Payment Sheet (add `@stripe/stripe-react-native` dependency); never touch raw card data (PCI SAQ-A); publishable key from env
    - _Requirements: 8.1, 8.5_
  - [x] 15.2 Implement CleanerPayoutOnboardingScreen + banners
    - Create `CleanerPayoutOnboardingScreen.tsx` opening the Express onboarding link in the system browser (`expo-web-browser`) and reflecting returned status; `components/PayoutOnboardingBanner.tsx` (while !payouts_enabled)
    - _Requirements: 8.2, 8.3, 8.5_
  - [x] 15.3 Implement PaymentStatusScreen + components
    - Create `PaymentStatusScreen.tsx` (payment + payout + dispute status, locale amounts), `components/PaymentStatusBadge.tsx`, `components/DisputeBanner.tsx` (while dispute OPEN), `components/RefundSheet.tsx` (Host full/partial refund entry with ceiling mirror)
    - All text via i18n keys; prices per locale + offer currency; add `payments` i18n namespace (en, es)
    - _Requirements: 8.4, 8.5, 8.6_

- [x] 16. Checkpoint — Full payment UX integrated
  - Ensure mobile + backend integration works; ask the user if questions arise.

- [x] 17. Property-Based Tests (fast-check)
  - [x]* 17.1 Property test: Money Integrity
    - **Property 1: Money Integrity**
    - **Validates: Requirements 6.1, 6.2**
    - Generate random prices; assert all monetary values are integers from CommissionService (no float)
  - [x]* 17.2 Property test: Breakdown Consistency
    - **Property 2: Breakdown Consistency**
    - **Validates: Requirements 6.3, 6.4**
    - Assert persisted host_total/cleaner_payout/gross equal CommissionService breakdown; net = gross minus fee minus adjustments
  - [x]* 17.3 Property test: Single Charge Per Offer
    - **Property 3: Single Charge Per Offer**
    - **Validates: Requirements 2.1, 2.6**
    - Concurrent offer.matched yields at most one payment + one SUCCEEDED attempt
  - [x]* 17.4 Property test: Single Release Per Payment
    - **Property 4: Single Release Per Payment**
    - **Validates: Requirements 3.6**
    - Concurrent release triggers yield at most one successful Transfer
  - [x]* 17.5 Property test: Escrow Safety
    - **Property 5: Escrow Safety**
    - **Validates: Requirements 2.7, 3.7, 5.6**
    - No transfer while HELD unconfirmed; auto-release never runs while dispute OPEN
  - [x]* 17.6 Property test: Payout Gate
    - **Property 6: Payout Gate**
    - **Validates: Requirements 3.2, 3.3, 1.6**
    - No Transfer when not payouts_enabled; deferred created once eligible
  - [x]* 17.7 Property test: Refund & Reversal Ceilings
    - **Property 7: Refund & Reversal Ceilings**
    - **Validates: Requirements 4.2, 4.3, 4.7**
    - Random refund/reversal sequences never exceed host_total / cleaner_payout
  - [x]* 17.8 Property test: Idempotency
    - **Property 8: Idempotency**
    - **Validates: Requirements 2.6, 3.6, 4.6, 5.4**
    - Replayed keys / redelivered event ids never double-charge/refund/transfer/reverse
  - [x]* 17.9 Property test: Webhook Authenticity
    - **Property 9: Webhook Authenticity**
    - **Validates: Requirements 5.1, 5.2**
    - Invalid or too-old signature is rejected, no mutation
  - [x]* 17.10 Property test: Authorization
    - **Property 10: Authorization**
    - **Validates: Requirements 1.7, 7.3, 7.5**
    - Only owner/matched read a payment; only owning Cleaner onboards
  - [x]* 17.11 Property test: Reconciliation Convergence
    - **Property 11: Reconciliation Convergence**
    - **Validates: Requirements 5.8, 3.5**
    - Interrupted flows converge via webhook + reconciliation (payments + accounts)
  - [x]* 17.12 Property test: Lifecycle Orthogonality
    - **Property 12: Lifecycle Orthogonality**
    - **Validates: Requirements 5.7, 5.8**
    - Random independent transitions never produce an illegal combined state; RELEASED+OPEN+PAID valid

- [x] 18. Integration & Scenario Tests
  - [x]* 18.1 Integration test: charge on match
    - offer.matched to PaymentIntent to HELD; verify breakdown snapshot, fee recorded, single payment
    - _Requirements: 2.1, 2.4, 6.3_
  - [x]* 18.2 Integration test: confirm to release Transfer
    - HELD to release to Transfer to Connected Account to RELEASED; payout_status PAID on transfer.paid
    - _Requirements: 3.1, 3.5_
  - [x]* 18.3 Integration test: deferred release on account eligible
    - Release while not payouts_enabled to PENDING; account becomes eligible (webhook AND reconciliation) to Transfer created
    - _Requirements: 3.2, 3.3_
  - [x]* 18.4 Integration test: pre-release full/partial refund + ceiling
    - Refund on HELD to REFUNDED/PARTIALLY_REFUNDED; over-ceiling rejected
    - _Requirements: 4.1, 4.2, 4.3_
  - [x]* 18.5 Integration test: post-release refund + Transfer Reversal
    - Refund after RELEASED to Transfer Reversal + Refund; reversal ceiling enforced; net revenue recomputed
    - _Requirements: 4.4, 4.5, 4.6_
  - [x]* 18.6 Integration test: dispute created to OPEN to auto-release paused
    - charge.dispute.created to dispute_status OPEN, orthogonal to payment_status; auto-release skips
    - _Requirements: 5.6, 5.7_
  - [x]* 18.7 Integration test: webhook dedup + DB constraints + reconciliation
    - Redelivered event id deduped; `uq_payment_offer` / `uq_one_succeeded_attempt` / `chk_refund_ceiling` / `chk_reversal_ceiling` enforced; interrupted charge reconciled; webhook before DB / out of order handled
    - _Requirements: 5.4, 5.11_
  - [x]* 18.8 Integration test: charge failed to retry (new attempt)
    - Failed charge to FAILED + payment.failed; retry creates attempt #2 to HELD
    - _Requirements: 2.5, 2.7_

- [x] 19. Final Checkpoint — All tests pass
  - Ensure all tests pass; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the universal correctness properties (P1–P12) from the design document
- The module NEVER writes the `offers` table and NEVER decides the offer's next state; it emits `payment.*` events (offer-publishing owns the offer state after `payment.failed`)
- All money math reuses `CommissionService` (no independent commission algorithm); money is integer minor units
- Three orthogonal lifecycles: `payment_status`, `dispute_status`, `payout_status`
- Charge retries create new `payment_attempts` (never mutate a prior attempt's Stripe ids)
- Post-release refunds use Transfer Reversal per the explicit refund policy; Stripe fee absorbed by the platform
- Escrow = platform-balance hold via separate charges & transfers (NOT a Stripe Escrow product / segregated account)
- Two reconciliation sweeps (payments + connected accounts) — never rely solely on webhooks
- All Stripe-mutating ops are idempotent; webhooks verified by signature + tolerance window; `payment_events` payload sanitized
- All UI text uses i18n keys; prices formatted per locale + offer currency
- All configurable values come from environment variables, validated at startup (fail-fast)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "3.1", "3.2"] },
    { "id": 1, "tasks": ["3.3", "3.4", "3.5", "4.1"] },
    { "id": 2, "tasks": ["4.2", "5.1", "5.2", "5.3"] },
    { "id": 3, "tasks": ["7.1", "7.2", "7.3", "8.1"] },
    { "id": 4, "tasks": ["8.2", "9.1", "9.2", "9.3"] },
    { "id": 5, "tasks": ["10.1", "10.2", "10.3"] },
    { "id": 6, "tasks": ["11.1", "11.2", "11.3"] },
    { "id": 7, "tasks": ["12.1", "12.2", "12.3", "12.4"] },
    { "id": 8, "tasks": ["14.1", "14.2", "14.3", "14.4"] },
    { "id": 9, "tasks": ["15.1", "15.2", "15.3"] },
    { "id": 10, "tasks": ["17.1", "17.2", "17.3", "17.4", "17.5", "17.6", "17.7", "17.8", "17.9", "17.10", "17.11", "17.12"] },
    { "id": 11, "tasks": ["18.1", "18.2", "18.3", "18.4", "18.5", "18.6", "18.7", "18.8"] }
  ]
}
```
