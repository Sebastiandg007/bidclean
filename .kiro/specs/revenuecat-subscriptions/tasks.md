# Implementation Plan: RevenueCat Subscriptions

## Overview

`revenuecat-subscriptions` becomes the source of truth for a user's subscription tier. It integrates RevenueCat (IAP system of record), maintains a durable per-user entitlement mirror fed by HMAC-verified webhooks (with an outbox/recovery guarantee) and a reconciliation backstop (that also discovers missing subscribers), and implements the real `SUBSCRIPTION_TIER` contract — extended with role-aware `getRoleTier(userId, role)` — retiring the FREE-returning stub in commission-system. Mobile gains the RevenueCat SDK + Paywalls UI, a subscription store, and the real `ad_free`/PRO gates.

Implementation is bottom-up: extend the contract in commission-system first (so both modules compile against it), then schema, then the pure/core pieces (types, tier service, event mapper, payload sanitizer, HMAC verifier, repository with per-entitlement ordering + outbox), then the webhook controller + processor + recovery worker, then reconciliation (converge + discover), then module wiring (A) + commission provider switch to per-role, then account-deletion cleanup, then the client endpoint, then mobile (SDK, store, paywalls, ad/PRO gates), followed by property-based, unit, and integration/scenario tests.

Coupling is one-directional: `CommissionModule -> SubscriptionsModule` via the `SUBSCRIPTION_TIER` token; `SubscriptionsModule` imports only the contract types/token from commission-system (no module cycle). commission-system owns the contract definition; this spec extends it and moves the binding.

## Tasks

- [ ] 1. Contract extension in commission-system (role-aware tier)
  - [ ] 1.1 Extend the SUBSCRIPTION_TIER contract with getRoleTier
    - Add `SubscriberRole` (`HOST | CLEANER`) to `services/api/src/commission/commission.types.ts`
    - Extend `SubscriptionTierContract` in `services/api/src/commission/contracts/subscription-tier.interface.ts` with `getRoleTier(userId, role): Promise<SubscriberTier>`; keep `getTier` for compatibility
    - _Requirements: 1.7_
  - [ ] 1.2 Switch CommissionRatesProvider to per-role resolution
    - Update `commission-rates.provider.ts`: Host fee lookup calls `getRoleTier(hostId, HOST)`, Cleaner commission lookup calls `getRoleTier(cleanerId, CLEANER)`; keep the bounded-timeout + FREE-degradation wrapper unchanged
    - Update `DefaultSubscriptionTierService` (temporary) to implement `getRoleTier` returning FREE, so commission-system still compiles before SubscriptionsModule exists
    - Update commission provider unit tests to stub `getRoleTier`
    - _Requirements: 1.7, 1.8_

- [ ] 2. Environment configuration & constants
  - [ ] 2.1 Add subscription environment variables to `.env.example`
    - Add `REVENUECAT_WEBHOOK_SIGNING_SECRET`, `REVENUECAT_WEBHOOK_AUTH_SECRET`, `REVENUECAT_WEBHOOK_TOLERANCE_SECONDS`, `SUBSCRIPTION_RECONCILE_INTERVAL_MS`, `SUBSCRIPTION_STALE_WINDOW_MS`, `SUBSCRIPTION_RECONCILE_BATCH`, `SUBSCRIPTION_DISPATCH_GRACE_MS`, `SUBSCRIPTION_MAX_RETRIES`, `SUBSCRIPTION_BACKOFF_DELAY_MS`, `RC_ENTITLEMENT_CLEANER_PRO`, `RC_ENTITLEMENT_HOST_PRO`, `RC_ENTITLEMENT_AD_FREE`, and mobile `EXPO_PUBLIC_RC_IOS_KEY` / `EXPO_PUBLIC_RC_ANDROID_KEY`
    - `REVENUECAT_API_KEY` / `REVENUECAT_API_URL` already exist (deletion cascade) — do NOT duplicate; document they are shared
    - _Requirements: 9.1, 9.2, 9.5_
  - [ ] 2.2 Create subscriptions constants with startup validation
    - Create `services/api/src/subscriptions/subscriptions.constants.ts`: reuse `REVENUECAT_API_KEY`/`REVENUECAT_API_URL`; parse the `SUBSCRIPTION_*` values; build `ENTITLEMENT_ID_MAP` (logical key -> configured RC id, no hardcoded fallback)
    - `validateSubscriptionsConfig()` fail-fast (non-test): `REVENUECAT_API_KEY` non-empty; at least one webhook secret (signing preferred); every `ENTITLEMENT_ID_MAP` value non-empty; all intervals/window/grace/retries/backoff positive; tolerance > 0
    - _Requirements: 9.3, 9.4, P10_

- [ ] 3. Backend — Database Schema & Migrations
  - [ ] 3.1 Create the subscriptions mirror migration
    - Create `services/api/src/migrations/1700000017000-CreateSubscriptions.ts` with `up()`/`down()`
    - Table `subscriptions`: id UUID PK, `user_id` UUID FK users ON DELETE CASCADE, per entitlement (`cleaner_pro`/`host_pro`/`ad_free`) an `_active` BOOLEAN, `_expires_at` TIMESTAMPTZ, `_store` VARCHAR(20), and `_last_event_at` TIMESTAMPTZ (per-entitlement ordering), `last_reconciled_at`, created_at/updated_at
    - Constraints: `uq_subscriptions_user`, per-store CHECK (`app_store|play_store|amazon|stripe|promotional`); indexes: user, `last_reconciled_at`, partial expiry index WHERE any pro active
    - _Requirements: 3.1, 3.2, 3.3, 3.5_
  - [ ] 3.2 Create the subscription events ledger/outbox migration
    - Create `services/api/src/migrations/1700000018000-CreateSubscriptionEvents.ts` with `up()`/`down()`
    - Table `subscription_events`: id UUID PK, `revenuecat_event_id` VARCHAR UNIQUE (dedup), `user_id` UUID **nullable, NO FK** (audit survives deletion), `event_type`, `entitlement_ids` VARCHAR[], `store`, `event_timestamp_ms` BIGINT, `expiration_at`, `payload_json` JSONB (sanitized), `dispatch_status` VARCHAR(12) DEFAULT 'RECEIVED' + CHECK (RECEIVED|QUEUED|PROCESSED|FAILED), `processed_at`, created_at
    - Indexes: (user_id, created_at), (event_type), partial dispatch index WHERE dispatch_status IN (RECEIVED, QUEUED)
    - _Requirements: 2.4, 2.5, 3.5, 8.1_

- [ ] 4. Backend — Types & Entities
  - [ ] 4.1 Create subscriptions types
    - Create `subscriptions.types.ts`: `EntitlementKey` (CLEANER_PRO|HOST_PRO|AD_FREE), `SubscriberRole`, `Store`, `RevenueCatEventType`, `EntitlementState`, `SubscriptionView` (tier + roleTiers + entitlements), `EntitlementDelta` (per-entitlement, with `transferToUserId`, `eventTimestampMs`)
    - _Requirements: 1.7, 2.6, 7.1_
  - [ ] 4.2 Create the entities
    - Create `entities/subscription.entity.ts` and `entities/subscription-event.entity.ts` matching the migrations, JSDoc on every column; timezone-aware timestamps; entities auto-discovered by the `**/*.entity.ts` glob
    - _Requirements: 3.1, 3.4, 2.4_

- [ ] 5. Backend — Pure Core (mapper, sanitizer, signature)
  - [ ] 5.1 Implement the RevenueCat event mapper (pure)
    - Create `revenuecat/revenuecat-event.mapper.ts`: `event -> EntitlementDelta[]`; INITIAL_PURCHASE/RENEWAL/UNCANCELLATION/PRODUCT_CHANGE -> active=true+expiry; CANCELLATION -> active-until-expiry; EXPIRATION -> active=false; BILLING_ISSUE/SUBSCRIPTION_PAUSED -> keep active-until-expiry (not forced false); TRANSFER -> source+destination deltas; unknown -> empty (no mutation)
    - Maps RC entitlement ids -> logical `EntitlementKey` via `ENTITLEMENT_ID_MAP`
    - _Requirements: 2.6, 2.9, 2.10_
  - [ ] 5.2 Implement the payload sanitizer (pure)
    - Create `revenuecat/revenuecat-payload.sanitizer.ts`: whitelist ONLY safe fields (event id, type, app_user_id, entitlement/product ids, store, timestamps, expiration); NEVER tokens, receipts, or PII
    - _Requirements: 2.4, P9_
  - [ ] 5.3 Implement the HMAC signature verifier (pure)
    - Create `revenuecat/revenuecat-signature.ts`: `verify(rawBody, signatureHeader, timestampHeader)` — HMAC-SHA256 over raw body with `REVENUECAT_WEBHOOK_SIGNING_SECRET`, timestamp-tolerance replay guard, constant-time comparison; bearer-secret fallback when signing secret absent
    - _Requirements: 2.2, P3_
  - [ ]* 5.4 Unit tests for mapper, sanitizer, signature
    - mapper per event type incl. PAUSED/BILLING semantics + TRANSFER pair + unknown; sanitizer whitelist (no secrets leak); signature valid/invalid/tampered/stale-timestamp/constant-time
    - _Requirements: 2.2, 2.6, 2.10_

- [ ] 6. Backend — Repository (mirror + ledger/outbox)
  - [ ] 6.1 Implement SubscriptionsRepository
    - Create `subscriptions.repository.ts`: `findByUserId`; `hasProcessedEvent`; `appendEvent(RECEIVED)`; `markQueued`/`markProcessed`/`markFailed`; `applyDeltas` (per-entitlement out-of-order guard using `*_last_event_at`; TRANSFER updates both rows in ONE transaction; marks ledger PROCESSED in the same tx); `findRecovered(grace, limit)`; `findStaleForReconciliation(window, limit)`; `findUserIdsMissingMirror(candidates)`; `upsertFromReconcile`; `markReconciled`; `removeForUser`; `anonymizeLedgerForUser`
    - _Requirements: 2.3, 2.7, 2.8, 2.9, 3.6, 4.6, 8.1_
  - [ ]* 6.2 Unit tests for repository invariants
    - dedup; per-entitlement ordering (late A not dropped by newer B); TRANSFER atomic both-rows; recovery selection; anonymize on deletion; upsertFromReconcile idempotent
    - _Requirements: 2.7, 2.8, 2.9, P15_

- [ ] 7. Backend — SUBSCRIPTION_TIER real implementation
  - [ ] 7.1 Implement RealSubscriptionTierService
    - Create `subscription-tier.service.ts` implementing the extended `SubscriptionTierContract`: `getRoleTier(userId, role)` (per-role active+future-expiry from mirror), `getTier(userId)` (HOST-tier OR CLEANER-tier); no mirror row -> FREE; `ad_free` never contributes
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.7, 1.8_
  - [ ]* 7.2 Unit tests for tier resolution
    - active/expired/none; host-only PRO -> Cleaner FREE + Host PRO (the P0 case); ad_free-alone -> FREE; getTier = OR of roles
    - _Requirements: 1.2, 1.7, 1.8_

- [ ] 8. Backend — RevenueCat client seam
  - [ ] 8.1 Implement RevenueCatClient
    - Create `revenuecat/revenuecat.client.ts`: `getSubscriber(appUserId)` (reconciliation), `deleteSubscriber(appUserId)` (account deletion); versioned base URL (pinned), `REVENUECAT_API_KEY`/`REVENUECAT_API_URL`; the only file calling RevenueCat over the network; never throws into a hot path
    - Create `revenuecat/revenuecat.constants.ts` (event type constants, logical->configured id helpers)
    - _Requirements: 4.1, 8.1_
  - [ ]* 8.2 Unit tests for RevenueCatClient (mocked fetch)
    - getSubscriber maps RC -> entitlement snapshot; deleteSubscriber handles 404; auth header attached
    - _Requirements: 4.1_

- [ ] 9. Checkpoint — Backend core compiles and unit tests pass
  - Ensure contract extension, constants, migrations, types/entities, mapper/sanitizer/signature, repository, tier service, and RC client compile and their unit tests pass; ask the user if questions arise.

- [ ] 10. Backend — Webhook ingress + processing + recovery
  - [ ] 10.1 Implement RevenueCatWebhookController (public, HMAC, outbox)
    - Create `webhooks/revenuecat-webhook.controller.ts`: public `POST /webhooks/revenuecat` (no JWT); verify HMAC (P3) else 401/400; dedup by event id (ack if seen); sanitize -> append ledger `RECEIVED` (committed BEFORE ack); enqueue BullMQ (mark QUEUED); return `{ received: true }`
    - Requires raw-body access (already enabled for Stripe) — reuse the same mechanism
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [ ] 10.2 Implement RevenueCatWebhookProcessor (BullMQ)
    - Create `webhooks/revenuecat-webhook.processor.ts`: `event -> mapper -> deltas -> repo.applyDeltas`; mark PROCESSED; retry/backoff on queue; exhausted -> FAILED/dead-letter (no event lost)
    - _Requirements: 2.6, 2.7, 2.8, 2.9, 2.10_
  - [ ] 10.3 Implement SubscriptionDispatchWorker (recovery)
    - Create `webhooks/subscription-dispatch.worker.ts` (`@Interval`): find ledger rows RECEIVED/QUEUED older than `SUBSCRIPTION_DISPATCH_GRACE_MS` not PROCESSED, re-enqueue; idempotent with the processor
    - _Requirements: 2.5, P16_
  - [ ]* 10.4 Unit tests for webhook controller + processor + recovery
    - HMAC 401; dedup ack; ledger RECEIVED before ack + enqueue+markQueued; processor applies deltas + PROCESSED; unknown event no mutation; recovery re-enqueues orphaned RECEIVED
    - _Requirements: 2.2, 2.3, 2.5, 2.8, P16_

- [ ] 11. Backend — Reconciliation (converge + discover)
  - [ ] 11.1 Implement SubscriptionReconciliationService
    - Create `reconciliation/subscription-reconciliation.service.ts` (`@Interval`): pass 1 converge stale/near-expiry rows via `getSubscriber` (idempotent no-op when correct); pass 2 discover subscribers with no mirror row from recently-active/known-event users and create rows from RC truth; `markReconciled`; RC unreachable -> log + retry next interval, mirror untouched
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [ ]* 11.2 Unit tests for reconciliation
    - converge diverged row; no-op on correct row; discover missing row; outage leaves mirror intact
    - _Requirements: 4.3, 4.5, 4.6, P6, P18_

- [ ] 12. Backend — Client endpoint + module wiring (A)
  - [ ] 12.1 Implement SubscriptionsService + GET /subscriptions/me (self-healing)
    - Create `subscriptions.service.ts` (build `SubscriptionView` from mirror; enqueue reconciliation when row missing/stale) and `subscriptions.controller.ts` (`@UseGuards(JwtAuthGuard)`, resolve keycloakId -> user id, scope to caller, no synchronous RC call)
    - _Requirements: 4.7, 7.1, 7.2, 7.3, 7.4_
  - [ ] 12.2 Wire SubscriptionsModule and re-wire CommissionModule
    - Create `subscriptions.module.ts`: `TypeOrmModule.forFeature([Subscription, SubscriptionEvent, User])`, BullMQ queue, ScheduleModule; providers incl. `{ provide: SUBSCRIPTION_TIER, useClass: RealSubscriptionTierService }`, repository, RC client, webhook controller/processor, dispatch worker, reconciliation; `exports: [SUBSCRIPTION_TIER]`; `onModuleInit` validates config; register in `AppModule`
    - Edit `CommissionModule`: `imports: [SubscriptionsModule]`, REMOVE `{ provide: SUBSCRIPTION_TIER, useClass: DefaultSubscriptionTierService }`, delete the now-unused stub; verify no cycle
    - _Requirements: 1.1, 9.3_
  - [ ]* 12.3 Unit tests for controller + wiring
    - /subscriptions/me scoping + JWT + self-heal enqueue; commission resolves via the real provider (integration-style with a fake repo)
    - _Requirements: 7.3, 7.4_

- [ ] 13. Backend — Account deletion integration
  - [ ] 13.1 Extend the deletion cascade with mirror cleanup
    - Update `profile/account/deletion-job.processor.ts`: keep the RevenueCat cancel step (optionally routed through `RevenueCatClient.deleteSubscriber`); add mirror cleanup — `subscriptions` row removed (CASCADE) and `subscription_events` anonymized (`user_id -> NULL`); idempotent, never blocks on RC availability
    - _Requirements: 8.1, 8.2, 8.3_
  - [ ]* 13.2 Unit tests for deletion cleanup
    - mirror removed + ledger anonymized; no-RC-subscriber path graceful; idempotent re-run
    - _Requirements: 8.2, 8.3_

- [ ] 14. Checkpoint — Backend subscription flow works end-to-end
  - Ensure webhook -> mirror -> getRoleTier -> commission resolves PRO at match; reconciliation heals; deletion cleans up; all backend tests pass; ask the user if questions arise.

- [ ] 15. Mobile — SDK, store & API client
  - [ ] 15.1 Add RevenueCat SDK + Paywalls UI and types/constants
    - Add `react-native-purchases` + `react-native-purchases-ui` (validated min versions) to `apps/mobile`; create `screens/subscriptions/subscriptions.types.ts`, `subscriptions.constants.ts` (ENDPOINTS, entitlement/offering ids from config, i18n keys)
    - _Requirements: 5.1, 6.5_
  - [ ] 15.2 Implement subscriptions API client
    - Create `subscriptions.api.ts`: typed `getMe()` -> `GET /subscriptions/me` via lazy `getApiClient()`
    - _Requirements: 7.1_
  - [ ] 15.3 Implement useSubscription Zustand store
    - Create `useSubscription.ts`: configure SDK with internal UUID `app_user_id` + platform public keys; derive active entitlements from `customerInfo`; `purchase(pkg)`, `restore()`; on purchase/customerInfo change call `getMe()` to converge; never grant entitlements locally
    - _Requirements: 5.2, 5.3, 5.4, 5.6, 6.3, 6.4_
  - [ ]* 15.4 Unit tests for useSubscription
    - customerInfo -> entitlements; purchase/restore; refresh-on-purchase; server-authoritative (no local grant)
    - _Requirements: 5.2, 5.4, 6.4_

- [ ] 16. Mobile — Paywalls & gates
  - [ ] 16.1 Implement PaywallScreen (Paywalls V2)
    - Create `PaywallScreen.tsx` using `react-native-purchases-ui`; present the role-appropriate offering (Cleaner PRO for Cleaners, Host PRO for Hosts) from active role; i18n cancel/pending/error handling; add `subscriptions` i18n namespace (en, es)
    - _Requirements: 6.1, 6.2, 6.4_
  - [ ] 16.2 Wire ad_free + PRO badge to real entitlements
    - Update `screens/radar/hooks/useAdVisibility.ts` to read real `ad_free` from the store (replace placeholder); create `components/ProBadge.tsx` gated per-role (`cleaner_pro` in Cleaner view, `host_pro` in Host view)
    - _Requirements: 5.5, 1.7_
  - [ ]* 16.3 Unit tests for paywall + gates
    - role-appropriate offering selection; ad_free gate reflects entitlement; ProBadge per-role
    - _Requirements: 5.5, 6.2_

- [ ] 17. Checkpoint — Full subscription UX integrated
  - Ensure mobile + backend integration works (purchase -> webhook -> mirror -> gates); ask the user if questions arise.

- [ ] 18. Property-Based Tests (fast-check)
  - [ ]* 18.1 Property test: Tier Derivation Correctness
    - **Property 1: Tier Derivation Correctness**
    - **Validates: Requirements 1.2, 1.3**
    - Random per-role entitlement/expiry; role tier PRO iff that role's entitlement active + future expiry
  - [ ]* 18.2 Property test: Backward-Compatible Default
    - **Property 2: Backward-Compatible Default**
    - **Validates: Requirements 1.5**
    - No mirror row -> FREE global and per-role
  - [ ]* 18.3 Property test: Webhook Authenticity
    - **Property 3: Webhook Authenticity**
    - **Validates: Requirements 2.2**
    - Tampered body / bad signature / stale timestamp -> rejected, no mutation
  - [ ]* 18.4 Property test: Idempotent Ingestion
    - **Property 4: Idempotent Ingestion**
    - **Validates: Requirements 2.8**
    - Replayed event ids / reprocessing never corrupt the mirror
  - [ ]* 18.5 Property test: Out-of-Order Convergence (same entitlement)
    - **Property 5: Out-of-Order Convergence**
    - **Validates: Requirements 2.7**
    - Shuffled same-entitlement streams; newest event wins
  - [ ]* 18.6 Property test: Reconciliation Convergence
    - **Property 6: Reconciliation Convergence**
    - **Validates: Requirements 4.1, 4.3**
    - Random RC-vs-mirror divergence converges; correct row is a no-op
  - [ ]* 18.7 Property test: Server Authority
    - **Property 7: Server Authority**
    - **Validates: Requirements 5.4, 7.3**
    - Client state never grants access; money/access reads the mirror
  - [ ]* 18.8 Property test: Safe Degradation
    - **Property 8: Safe Degradation**
    - **Validates: Requirements 1.6, 8.3**
    - RC outage never changes a resolved tier nor blocks create/match/deletion
  - [ ]* 18.9 Property test: No Sensitive Persistence
    - **Property 9: No Sensitive Persistence**
    - **Validates: Requirements 2.4, 3.4**
    - Sanitized payload/mirror never contain tokens/receipts/PII
  - [ ]* 18.10 Property test: Configuration Integrity
    - **Property 10: Configuration Integrity**
    - **Validates: Requirements 9.4**
    - Missing entitlement id mapping fails startup; no hardcoded fallback
  - [ ]* 18.11 Property test: Role-Tier Independence
    - **Property 11: Role-Tier Independence**
    - **Validates: Requirements 1.7**
    - Mixed cleaner/host PRO resolves independently per role
  - [ ]* 18.12 Property test: ad_free Non-Implication
    - **Property 12: ad_free Non-Implication**
    - **Validates: Requirements 1.8**
    - ad_free alone never resolves PRO
  - [ ]* 18.13 Property test: Transfer Integrity
    - **Property 13: Transfer Integrity**
    - **Validates: Requirements 2.9**
    - After TRANSFER, entitlement on destination only (atomic)
  - [ ]* 18.14 Property test: Purchase-Window Determinism
    - **Property 14: Purchase-Window Determinism**
    - **Validates: Requirements 6.3, 6.4**
    - Server PRO effective only after mirror update; client converges via /subscriptions/me
  - [ ]* 18.15 Property test: Per-Entitlement Ordering
    - **Property 15: Per-Entitlement Ordering**
    - **Validates: Requirements 2.7**
    - A late-but-valid event for A is never dropped because a newer event arrived for B
  - [ ]* 18.16 Property test: Webhook Durability
    - **Property 16: Webhook Durability**
    - **Validates: Requirements 2.5**
    - Enqueue-fail after ACK -> RECEIVED row recovered and processed
  - [ ]* 18.17 Property test: Role-Specific Tier
    - **Property 17: Role-Specific Tier**
    - **Validates: Requirements 1.7**
    - cleaner_pro affects Cleaner tier only; host_pro affects Host tier only
  - [ ]* 18.18 Property test: Reconciliation Discovers Missing Subscribers
    - **Property 18: Reconciliation Discovers Missing Subscribers**
    - **Validates: Requirements 4.6**
    - Reconciliation creates missing mirror rows, not only refreshes existing

- [ ] 19. Integration & Scenario Tests
  - [ ]* 19.1 Integration: purchase webhook -> mirror -> commission PRO at match
    - INITIAL_PURCHASE(cleaner_pro) -> mirror -> `getRoleTier(CLEANER)=PRO` -> commission Cleaner rate at match reflects PRO
    - _Requirements: 1.1, 1.7_
  - [ ]* 19.2 Integration: host-only PRO -> Cleaner FREE, Host PRO (the P0 case)
    - Only host_pro active -> Host fee PRO, Cleaner commission FREE
    - _Requirements: 1.7_
  - [ ]* 19.3 Integration: expiration -> FREE
    - EXPIRATION(cleaner_pro) -> `getRoleTier(CLEANER)=FREE`
    - _Requirements: 1.2, 1.3_
  - [ ]* 19.4 Integration: enqueue failure -> recovery processes
    - Ledger RECEIVED with no queued job -> dispatch worker re-enqueues -> PROCESSED
    - _Requirements: 2.5, P16_
  - [ ]* 19.5 Integration: interleaved out-of-order A/B streams
    - Late host_pro event not dropped by newer cleaner_pro event
    - _Requirements: 2.7, P15_
  - [ ]* 19.6 Integration: TRANSFER moves entitlement
    - TRANSFER source->destination; entitlement on destination only after
    - _Requirements: 2.9_
  - [ ]* 19.7 Integration: missed webhook -> reconciliation heals + discovers
    - No webhook; reconciliation converges existing + discovers a missing subscriber row
    - _Requirements: 4.1, 4.6_
  - [ ]* 19.8 Integration: account deletion cleanup
    - Deletion removes mirror + anonymizes ledger; empty mirror reproduces prior flat commission behavior
    - _Requirements: 8.1, 8.3_

- [ ] 20. Final Checkpoint — All tests pass
  - Ensure all backend + mobile tests pass and the CI-equivalent commands are green locally (services/api tsc + eslint --max-warnings 0 + jest; packages/shared tsc); ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the universal correctness properties (P1-P18) from the design document
- This spec MODIFIES commission-system: it extends the `SUBSCRIPTION_TIER` contract with `getRoleTier`, switches `CommissionRatesProvider` to per-role resolution, and removes the default stub binding. commission-system must be merged first; branch from `develop`.
- Coupling is one-directional: `CommissionModule -> SubscriptionsModule` via the token; `SubscriptionsModule` imports only the contract types/token (no module cycle)
- RevenueCat is the source of truth; the mirror is the runtime read model; the client is a UI convenience (never grants access)
- Two-moment / role-aware: Host fee uses `getRoleTier(HOST)`, Cleaner commission uses `getRoleTier(CLEANER)`; `ad_free` never implies PRO
- Webhook durability: ledger row committed BEFORE ack + recovery worker re-enqueues orphaned RECEIVED rows (no acknowledged event lost)
- Per-entitlement ordering: each entitlement has its own `last_event_at`; a late event for one entitlement is never dropped by a newer event for another
- HMAC-SHA256 webhook verification (timestamp tolerance + constant-time compare); bearer fallback only when signing secret is absent
- Reconciliation converges existing rows AND discovers missing subscribers; `/subscriptions/me` self-heals async without a synchronous RevenueCat call
- Subscription ledger has NO FK to users (audit history survives deletion; user_id anonymized on deletion)
- No hardcoded identifiers: logical entitlement keys map to configured RC ids; missing mapping fails startup
- MVP platforms iOS + Android; Amazon Appstore out of scope
- Migrations `1700000017000` (mirror) + `1700000018000` (ledger) follow the commission migrations
- All configurable values come from environment variables, validated at startup (fail-fast)
- Credentials needed at implementation time: `REVENUECAT_API_KEY` (secret server), `REVENUECAT_WEBHOOK_SIGNING_SECRET`, and mobile `EXPO_PUBLIC_RC_IOS_KEY` / `EXPO_PUBLIC_RC_ANDROID_KEY`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "2.2"] },
    { "id": 1, "tasks": ["3.1", "3.2", "4.1", "4.2"] },
    { "id": 2, "tasks": ["5.1", "5.2", "5.3", "5.4"] },
    { "id": 3, "tasks": ["6.1", "6.2", "7.1", "7.2", "8.1", "8.2"] },
    { "id": 4, "tasks": ["10.1", "10.2", "10.3", "10.4"] },
    { "id": 5, "tasks": ["11.1", "11.2"] },
    { "id": 6, "tasks": ["12.1", "12.2", "12.3"] },
    { "id": 7, "tasks": ["13.1", "13.2"] },
    { "id": 8, "tasks": ["15.1", "15.2", "15.3", "15.4"] },
    { "id": 9, "tasks": ["16.1", "16.2", "16.3"] },
    { "id": 10, "tasks": ["18.1", "18.2", "18.3", "18.4", "18.5", "18.6", "18.7", "18.8", "18.9", "18.10", "18.11", "18.12", "18.13", "18.14", "18.15", "18.16", "18.17", "18.18"] },
    { "id": 11, "tasks": ["19.1", "19.2", "19.3", "19.4", "19.5", "19.6", "19.7", "19.8"] }
  ]
}
```
