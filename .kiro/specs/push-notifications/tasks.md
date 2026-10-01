# Implementation Plan: Push Notifications

## Overview

`push-notifications` (Spec 16) consolidates BidClean's offer-scoped push into a single, first-class `notifications` NestJS module driven by a **durable transactional outbox**. Implementation is bottom-up and incremental: shared types + the domain-agnostic `OutboxWriter` + all migrations first, then the notifications core (type registry, content catalog, preference decision function, device registry, notification service), then delivery (BullMQ worker + generalized `OneSignalClient` + signed webhook), then registry↔OneSignal sync + reconcile sweep, then the controllers + module wiring + config validation, then the **behavior-preserving cross-cutting migration** of the five emitting domains onto the outbox (offers loses its direct `OneSignalClient.send`), then mobile, then property/integration tests, then docs + ADR.

The module **reacts, never a source of business truth**: the emitting domain writes its outbox row in the same transaction as the business fact; the relay drains committed rows into deduped intents; the delivery worker single-winners `PENDING → PROCESSING` and sends per consented player id (Model B). Delivery *intent* is exactly-once in PostgreSQL; external OneSignal delivery is at-least-once/best-effort. The one migration is behavior-preserving for offer-radar (REQ-NP13). `packages/shared` stays strictly domain-agnostic. All config is env-driven with fail-fast validation; the REST key is server-only. This design maps to correctness properties **P1 … P18**; property-based tests are written for **P3, P6, P8, P9, P10, P12, P14, P17, P18** (the pure decision/dedup/targeting logic).

## Tasks

- [ ] 1. Shared outbox infrastructure and notification types
  - [ ] 1.1 Add domain-agnostic `OutboxWriter` to `packages/shared`
    - Create `packages/shared/src/outbox/outbox-writer.ts` exporting a pure `writeOutbox(tx, { eventId, aggregateType, aggregateId, type, payload, version, tableName })` that INSERTs one row into the caller-named outbox table within the caller's transaction
    - MUST carry NO offer/payment/negotiation/chat/voip semantics — no domain mapping, no business branches, no type-specific logic; export the `OutboxRow` shape type only
    - Export from `packages/shared` index without a barrel that hides origin
    - _Requirements: 2.1_ · _Design: shared `OutboxWriter` invariant_
  - [ ] 1.2 Add shared notification types
    - Create `packages/shared/src/types/notification.types.ts`: `NotificationType`, `NotificationCategory`, `NotificationPriority` (`HIGH`/`NORMAL`/`LOW`), `NotificationChannel` (`PUSH`), `NotificationStatus` (`PENDING`/`PROCESSING`/`SENT`/`FAILED_RETRYABLE`/`FAILED_FINAL`/`SUPPRESSED`), `Platform` (`IOS`/`ANDROID`/`WEB`), `SuppressionReason`, `DeepLink`, `NotificationIntent`
    - Additions only; no changes to existing shared consumers
    - _Requirements: 7.1_

- [ ] 2. Backend — Database migrations (outbox, devices, preferences, ledger, webhook events)
  - [ ] 2.1 Create the per-domain outbox tables migration
    - Create `services/api/src/migrations/<timestamp>-CreateDomainOutboxTables.ts` with `up()`/`down()` creating `offer_outbox`, `payment_outbox`, `negotiation_outbox`, `chat_outbox`, `voip_outbox`
    - Each table: `id` UUID PK `gen_random_uuid()`, `event_id` VARCHAR(255) NOT NULL, `aggregate_type` VARCHAR(30), `aggregate_id` UUID, `type` VARCHAR(50), `payload` JSONB, `version` INTEGER DEFAULT 1, `created_at` TIMESTAMPTZ DEFAULT NOW(), `relayed_at` TIMESTAMPTZ NULL
    - Constraints/indexes per table: `uq_<domain>_outbox_event (event_id)`; partial `idx_<domain>_outbox_unrelayed (created_at) WHERE relayed_at IS NULL`; table/column comments; `IF NOT EXISTS`; reversible `down()`
    - No FK to `users` (recipient resolution happens in the mapper)
    - _Requirements: 2.1, 7.1_ · _Design: `<domain>_outbox` data model_
  - [ ] 2.2 Create the `notification_devices` migration
    - Create `services/api/src/migrations/<timestamp>-CreateNotificationDevices.ts`
    - Columns: `id` UUID PK, `user_id` UUID NOT NULL FK → `users(id)` **ON DELETE CASCADE**, `platform` VARCHAR(10), `onesignal_player_id` VARCHAR(255), `onesignal_external_user_id` VARCHAR(255), `consent_granted` BOOLEAN DEFAULT false, `is_stale` BOOLEAN DEFAULT false, `last_seen_at` TIMESTAMPTZ NULL, `created_at`/`updated_at` TIMESTAMPTZ DEFAULT NOW()
    - Constraints/indexes: `uq_notification_devices_user_player (user_id, onesignal_player_id)`; `idx_notification_devices_user (user_id)`; partial `idx_notification_devices_consented (user_id) WHERE consent_granted = true AND is_stale = false`; `CHECK` for `platform`; comments; reversible
    - _Requirements: 1.1, 7.1, 7.2_ · _Design: `notification_devices`_
  - [ ] 2.3 Create the `notification_preferences` migration
    - Create `services/api/src/migrations/<timestamp>-CreateNotificationPreferences.ts`
    - Columns: `id` UUID PK, `user_id` UUID NOT NULL FK → `users(id)` **ON DELETE CASCADE**, `category_opt_out` JSONB DEFAULT '{}', `quiet_hours_start`/`quiet_hours_end` TIME NULL, `quiet_hours_timezone` VARCHAR(64) NULL, `language` VARCHAR(35) NULL, `created_at`/`updated_at`
    - Constraints: `uq_notification_preferences_user (user_id)`; comments; reversible
    - _Requirements: 4.4, 7.1, 7.2_ · _Design: `notification_preferences`_
  - [ ] 2.4 Create the `notifications` ledger migration
    - Create `services/api/src/migrations/<timestamp>-CreateNotificationsLedger.ts`
    - Columns per design: `id` UUID PK, `recipient_user_id` UUID NOT NULL FK → `users(id)` **ON DELETE CASCADE**, `type` VARCHAR(50), `category` VARCHAR(30), `channel` VARCHAR(20) DEFAULT 'PUSH', `dedup_key` VARCHAR(255) NOT NULL, `deep_link` JSONB, `payload_ref` JSONB NULL, `priority` VARCHAR(10), `status` VARCHAR(20) DEFAULT 'PENDING', `suppression_reason` VARCHAR(30) NULL, `attempt` INTEGER DEFAULT 0, `sent_at` TIMESTAMPTZ NULL, `created_at`/`updated_at`; **no `deleted_at`**
    - Constraints/indexes: `uq_notifications_dedup (dedup_key)`; `idx_notifications_recipient_created (recipient_user_id, created_at DESC)`; `idx_notifications_status (status)`; partial `idx_notifications_pending (status, created_at) WHERE status='PENDING'`; `CHECK` for `status`/`priority`/`channel`/`category`; comments; reversible
    - _Requirements: 7.1, 7.2, 7.4_ · _Design: `notifications` (ledger)_
  - [ ] 2.5 Create the `onesignal_webhook_events` migration
    - Create `services/api/src/migrations/<timestamp>-CreateOnesignalWebhookEvents.ts`
    - Columns: `id` UUID PK, `provider_event_id` VARCHAR(255) NOT NULL, `event_type` VARCHAR(50), `received_at` TIMESTAMPTZ DEFAULT NOW()
    - Constraint: `uq_onesignal_webhook_provider_event (provider_event_id)`; comments; reversible
    - _Requirements: 6.4, 7.1_ · _Design: `onesignal_webhook_events`_

- [ ] 3. Backend — Config, constants, entities, and the notification type registry
  - [ ] 3.1 Create notifications constants and fail-fast config validation
    - Create `services/api/src/notifications/notifications.constants.ts` with all env-configurable values: `ONESIGNAL_APP_ID`, `ONESIGNAL_API_KEY`, `ONESIGNAL_API_URL`, `ONESIGNAL_TIMEOUT_MS`, `ONESIGNAL_WEBHOOK_SECRET`, `NOTIFICATIONS_DELIVERY_MAX_ATTEMPTS`, `NOTIFICATIONS_DELIVERY_BACKOFF_MS`, `NOTIFICATIONS_RELAY_INTERVAL_MS`, `NOTIFICATIONS_RELAY_BATCH_SIZE`, `NOTIFICATIONS_RECONCILE_INTERVAL_MS`, `NOTIFICATIONS_RECONCILE_BATCH_SIZE`, `NOTIFICATIONS_RETENTION_DAYS`, default preferences + quiet-hours defaults, `NOTIFICATIONS_QUEUE_NAMES`
    - Implement `validateNotificationsConfig()` fail-fast: required OneSignal keys/URL/webhook secret non-empty in non-test env; all intervals/batch/backoff/attempts/retention > 0; no hardcoded business values in logic
    - _Requirements: 6.1, 6.2_ · _Design: Configuration_ · P12(config)
  - [ ] 3.2 Create notifications TypeORM entities
    - Create entities for `notification_devices`, `notification_preferences`, `notifications`, `onesignal_webhook_events`, and the five `<domain>_outbox` tables (read-model entities for the relay) with JSDoc on every column matching the migrations
    - _Requirements: 7.1_
  - [ ] 3.3 Implement `NotificationTypeRegistry`
    - Create `services/api/src/notifications/notification-type.registry.ts`: config-driven `Map<NotificationType, NotificationTypeMetadata>` where metadata = `{ priority, category, quietHoursBehavior, defaultEnabled }`, loaded from constants (no literals in logic)
    - Populate all types: `offer.matched/cancelled/expired/completed`, `payment.captured/released/failed/refunded/disputed`, `negotiation_proposal_created/countered/rejected/accepted`, `message-created`, `call-invited` (`priority: HIGH`, `quietHoursBehavior: EXEMPT`)
    - _Requirements: 4.1, 4.2, 4.4_ · _Design: `NotificationTypeRegistry`_ · P8
  - [ ] 3.4 Implement `NotificationContentCatalog` with en/es parity check
    - Create `services/api/src/notifications/notification-content.catalog.ts`: per-type `{ en, es }` `{ headings, contents }` templates interpolated with payload ids/labels; `render(type, language, payload)`; startup parity check throwing when a type is missing `en` or `es`; none hardcoded in delivery logic
    - _Requirements: 3.4_ · _Design: `NotificationContentCatalog`_ · P15
  - [ ]* 3.5 Write unit tests for registry, catalog, and config validation
    - Registry returns metadata for every declared type; `call-invited` is HIGH/EXEMPT
    - Catalog en/es parity check fails on a missing key; interpolation uses ids only (P15)
    - `validateNotificationsConfig()` throws on missing required values (P12-config)
    - _Requirements: 3.4, 4.1, 6.1_

- [ ] 4. Backend — Preference decision function (pure)
  - [ ] 4.1 Implement `PreferenceService.decide` (pure)
    - Create `services/api/src/notifications/preference.service.ts` with pure `decide(metadata, prefs, hasConsentedDevice, foregroundKnownActive): DeliveryDecision` returning `DELIVER | SUPPRESS(reason)`
    - Rules: no consented device → `SUPPRESS(no-device)`; category opt-out (absent prefs fall back to metadata `defaultEnabled`) → `SUPPRESS(opted-out)`; quiet-hours window with tz when `quietHoursBehavior=RESPECT` → `SUPPRESS(quiet-hours)`; `EXEMPT`/`HIGH` bypasses quiet-hours + non-urgent opt-outs (still honors full unregister → no-device); foreground reliably-active → `SUPPRESS(foreground)` only when known, else `DELIVER` (fail-open, messages/calls always deliver)
    - Functions ≤30 lines, SRP, no branching on specific type names
    - _Requirements: 4.1, 4.2, 4.3, 4.4_ · _Design: `PreferenceService`_ · P8, P9, P10
  - [ ]* 4.2 Property test: metadata-driven suppression, calls exempt
    - **Property 8: Metadata-driven suppression, calls exempt**
    - **Validates: Requirements 4.1, 4.2, 4.4**
    - fast-check (≥100 iters): arbitrary metadata × prefs × quiet-hours windows/tz → decision matches the pure spec; `EXEMPT`/`HIGH` always delivers (mod full unregister)
  - [ ]* 4.3 Property test: default preferences from metadata
    - **Property 9: Default preferences from metadata**
    - **Validates: Requirements 4.4**
    - fast-check (≥100 iters): absent prefs for a category → decision uses that type's `defaultEnabled`, never a hardcoded value
  - [ ]* 4.4 Property test: foreground coordination is fail-open
    - **Property 10: Foreground coordination is fail-open**
    - **Validates: Requirements 4.3**
    - fast-check (≥100 iters): foreground-known/unknown × types → suppress only when reliably active; `message-created`/`call-invited` always deliver

- [ ] 5. Backend — Device registry (Model B)
  - [ ] 5.1 Implement `NotificationRepository` device/preference/ledger reads and writes
    - Create `services/api/src/notifications/notifications.repository.ts` (parameterized SQL only): upsert device by `(user_id, onesignal_player_id)`; update consent; delete device; `resolveConsentedPlayerIds(userId)` via the consented partial index; `markStale(playerId)`; get/upsert preferences; insert ledger row with final initial status; single-winner `PENDING → PROCESSING` conditional update; set `SENT`/`FAILED_*`/`SUPPRESSED`; retention prune of aged terminal rows; relay scan `WHERE relayed_at IS NULL`; `markRelayed(event_id)`; webhook `provider_event_id` dedup insert
    - _Requirements: 1.1, 1.2, 1.3, 3.1, 7.1, 7.3, 7.5_
  - [ ] 5.2 Implement `DeviceRegistryService` (Model B authority)
    - Create `services/api/src/notifications/device-registry.service.ts`: `registerDevice`, `updateConsent`, `unregisterDevice` (per-device, never affects other devices), `resolveConsentedPlayerIds` (reconciled targeting set, excludes stale/opted-out), `markStale`, `applySubscriptionWebhook` (idempotent via `provider_event_id`), `computeTags(user)` (role/subscription/country/language/verified/last_active)
    - After registry mutation, best-effort push external-user-id association + tags to OneSignal via `OneSignalClient` (sync); never throws into caller
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.7_ · _Design: `DeviceRegistryService`_ · P6, P17
  - [ ]* 5.3 Property test: per-device consent targeting (Model B)
    - **Property 6: Per-device consent targeting (Model B)**
    - **Validates: Requirements 1.1, 1.2, 1.3, 3.1**
    - fast-check (≥100 iters): arbitrary device sets with random `consent_granted`/`is_stale` → resolved set equals exactly the consented, non-stale player ids; never a blanket fan-out
  - [ ]* 5.4 Write unit tests for `DeviceRegistryService`
    - Multi-device consent isolation; `markStale` excludes a player id from targeting; `applySubscriptionWebhook` idempotent by `provider_event_id`
    - _Requirements: 1.3, 1.5, 1.7_

- [ ] 6. Backend — Notification service (intent mapping, dedup, atomic suppression)
  - [ ] 6.1 Implement per-domain intent mappers
    - Create `services/api/src/notifications/mappers/` with one mapper per emitting domain mapping a `<domain>_outbox` row → `NotificationIntent { recipientUserId, type, category, dedupKey (derived from event_id + version + recipient), deepLink ({ type, ...ids } — ids only), localizedContentRef, priority }`
    - Deep-link shapes: `{ type: 'offer_matched', offerId }`, `{ type: 'incoming_call', callId, conversationId }`, etc.; no sensitive content
    - _Requirements: 2.2, 3.3_ · _Design: domain→intent mapping lives in notifications, not shared_ · P14
  - [ ] 6.2 Implement `NotificationService.createIntent` (durable-first, atomic suppression)
    - Create `services/api/src/notifications/notification.service.ts`: `createIntent(intent)` computes `PreferenceService.decide(...)` FIRST, then INSERTs the ledger row **already in its final initial status** (`SUPPRESSED(reason)` or `PENDING`) so no transient `PENDING` is ever observable before suppression is applied; unique-violation on `dedup_key` → return existing (no-op, exactly-once intent); enqueue delivery ONLY after a `PENDING` row is committed (durable-first); never throws in a way that stops the relay batch (per-row try/catch)
    - Add `getLedger(id)` / `listForRecipient(userId)` self-scoped audit reads
    - _Requirements: 2.2, 2.3, 2.4, 4.5, 7.5_ · _Design: `NotificationService`_ · P3, P4, P5, P11
  - [ ]* 6.3 Property test: exactly-once intent under redelivery and races
    - **Property 3: Exactly-once intent under redelivery and races**
    - **Validates: Requirements 2.2, 2.3, 7.5**
    - fast-check (≥100 iters): arbitrary redelivery counts + concurrent relay/worker interleavings → at most one ledger row per `dedup_key`; every duplicate is a no-op
  - [ ]* 6.4 Property test: deep-link routing, ids only
    - **Property 14: Deep-link routing, ids only**
    - **Validates: Requirements 3.3, 5.2, 5.3, 6.3**
    - fast-check (≥100 iters): arbitrary types/ids → mapper payload carries the typed id-based deep-link and no forbidden content fields
  - [ ]* 6.5 Write unit tests for `NotificationService`
    - Durable-first ordering (PENDING committed before enqueue — P4); no-device → `SUPPRESSED(no-device)` non-throwing (P5); dedup no-op (P3); suppression audited never a failure (P11)
    - _Requirements: 2.2, 2.4, 4.5_

- [ ] 7. Backend — Outbox relay
  - [ ] 7.1 Implement `OutboxRelayProcessor`
    - Create `services/api/src/notifications/outbox-relay.processor.ts` (BullMQ repeatable; interval/batch from config): drain each `<domain>_outbox` for `relayed_at IS NULL` ordered by `created_at` bounded batch; per row build intent via the domain mapper → `NotificationService.createIntent()` → `markRelayed(event_id)`; row-scoped try/catch so a mapper throw leaves the row unrelayed for the next drain and never touches the (already committed) emitting transaction
    - _Requirements: 2.2, 2.5_ · _Design: Relay → intent flow_ · P1, P2
  - [ ]* 7.2 Write unit tests for the relay
    - Relay scans only `relayed_at IS NULL`; marks relayed after intent persist; a mapper throw is row-scoped and retried next drain (P1)
    - _Requirements: 2.2, 2.5_

- [ ] 8. Checkpoint — Notifications core compiles and unit/property tests pass
  - Ensure migrations, config, registry, catalog, preference function, device registry, notification service, and relay compile and their tests pass; ask the user if questions arise.

- [ ] 9. Backend — OneSignal client and delivery worker
  - [ ] 9.1 Implement generalized `OneSignalClient`
    - Create `services/api/src/notifications/onesignal/onesignal.client.ts` (moved/generalized from `offers`): best-effort `send({ playerIds, headings, contents, data, idempotencyKey })`; `associateExternalUserId` + `setTags`; reads `ONESIGNAL_*` from config; wraps the REST API with `ONESIGNAL_TIMEOUT_MS`; graceful failure — logs without secrets/PII, never throws into callers; reports invalid player ids to the caller. REST key server-only
    - _Requirements: 3.1, 3.2, 6.2, 6.3_ · _Design: `OneSignalClient`_ · P13
  - [ ] 9.2 Implement `DeliveryWorker`
    - Create `services/api/src/notifications/delivery.worker.ts` (BullMQ): single-winner `UPDATE ... WHERE id=:id AND status='PENDING'` (rows=0 → no-op); resolve consented player ids → empty → `SUPPRESSED(no-device)`, no OneSignal call; else render content from catalog and `OneSignalClient.send` per player id with a provider idempotency key → `SENT`; error/timeout → `FAILED_RETRYABLE` (BullMQ retry with configured backoff) → `FAILED_FINAL` on exhaustion; invalid player id → `markStale` (not repeatedly retried); never throws into a business flow
    - _Requirements: 3.1, 3.2, 3.5, 7.5_ · _Design: Delivery flow_ · P12, P13
  - [ ]* 9.3 Property test: single-winner status transition
    - **Property 12: Single-winner status transition**
    - **Validates: Requirements 3.1, 7.5**
    - fast-check (≥100 iters): N concurrent `PENDING → PROCESSING` attempts on one ledger row → exactly one winner; losers observe rows=0 and no-op
  - [ ]* 9.4 Write unit tests for delivery + OneSignal client
    - Per-device send (Model B); best-effort graceful failure never throws, success→SENT, error→FAILED_RETRYABLE→FAILED_FINAL (P13); invalid player id → markStale; no-device → SUPPRESSED
    - _Requirements: 3.1, 3.2, 3.5_

- [ ] 10. Backend — OneSignal webhook and registry reconcile sweep
  - [ ] 10.1 Implement `OneSignalWebhookController` (signed, idempotent)
    - Create `services/api/src/notifications/webhooks/onesignal-webhook.controller.ts` (`POST /webhooks/onesignal`, NOT under `JwtAuthGuard`): verify the OneSignal signature/secret over the **preserved raw body** (mirror Stripe/RevenueCat controllers), reject unauthenticated (`401`) with no mutation; dedup by stored `provider_event_id UNIQUE` (redelivery → idempotent `200 { received: true }`); route delivery callbacks → opportunistic ledger status update (open/click never drives business logic), subscription-change callbacks → `DeviceRegistryService.applySubscriptionWebhook`
    - Ensure the raw-body parser is configured for this route only
    - _Requirements: 1.5, 6.4_ · _Design: `OneSignalWebhookController`_ · P16
  - [ ] 10.2 Implement `ReconcileSweepProcessor`
    - Create `services/api/src/notifications/reconcile-sweep.processor.ts` (BullMQ repeatable; `NOTIFICATIONS_RECONCILE_INTERVAL_MS`/`_BATCH_SIZE`): bounded periodic drift repair — registry devices missing/invalid in OneSignal marked stale or re-pushed; OneSignal subscriptions absent from the registry reconciled; ensures a send never targets a stale player id and a consented device is never silently unreachable
    - _Requirements: 1.6, 1.7_ · _Design: `ReconcileSweepProcessor`_ · P17
  - [ ]* 10.3 Property test: registry ↔ OneSignal convergence
    - **Property 17: Registry ↔ OneSignal convergence**
    - **Validates: Requirements 1.5, 1.6, 1.7**
    - fast-check (≥100 iters): arbitrary op/webhook/sweep sequences → target set excludes stale ids; consented devices represented after sync/sweep
  - [ ]* 10.4 Write unit tests for the webhook controller
    - Valid signature accepted; invalid/missing/tampered signature → 401 no mutation; duplicate `provider_event_id` → no-op 200 (P16)
    - _Requirements: 6.4_

- [ ] 11. Backend — Controllers and module wiring
  - [ ] 11.1 Implement `NotificationDeviceController` + `NotificationPreferenceController` + DTOs
    - Create `services/api/src/notifications/notification-device.controller.ts` (`@UseGuards(JwtAuthGuard)`, whitelisting `ValidationPipe`): `POST /notifications/devices` (register/upsert), `PATCH /notifications/devices/:playerId/consent`, `DELETE /notifications/devices/:playerId`; identity from `req.user.keycloakId → userId`; a body `userId` differing from the JWT subject → `403`, mutate nothing
    - Create `notification-preference.controller.ts`: `GET /notifications/preferences`, `PUT /notifications/preferences` (categories + quiet-hours window + tz + language), self-scoped
    - Create DTOs (`RegisterDeviceDto`, `UpdateConsentDto`, `UpdatePreferencesDto`) with class-validator
    - _Requirements: 1.1, 1.3, 1.4, 4.4, 5.5_ · P7
  - [ ] 11.2 Wire `NotificationsModule`
    - Create `services/api/src/notifications/notifications.module.ts` importing `TypeOrmModule.forFeature([...entities])`, `BullModule` (register relay/delivery/reconcile queues), `ScheduleModule`; register controllers (device, preference, webhook), services (`NotificationService`, `PreferenceService`, `DeviceRegistryService`), processors/workers (`OutboxRelayProcessor`, `DeliveryWorker`, `ReconcileSweepProcessor`), `NotificationTypeRegistry`, `NotificationContentCatalog`, `OneSignalClient`, repository, mappers; call `validateNotificationsConfig()` in `onModuleInit`; register in `AppModule`
    - _Requirements: 6.1, 6.5_
  - [ ]* 11.3 Property test: registry authorization
    - **Property 7: Registry authorization**
    - **Validates: Requirements 1.4**
    - fast-check (≥100 iters): device register/consent/unregister for a non-subject user id or unauthenticated caller → `401`/`403` and mutate nothing
  - [ ]* 11.4 Write unit tests for the controllers
    - JWT-subject authorization (403 on mismatch — P7); device register/consent/unregister happy paths; preference get/update self-scoped; DTO validation
    - _Requirements: 1.1, 1.3, 1.4, 4.4_

- [ ] 12. Backend — Cross-cutting emitting-domain outbox migration (behavior-preserving)
  - [ ] 12.1 Add outbox writes to `payments`, `negotiation`, `chat`, `voip-calls`
    - In each emitting domain's existing write path, call the shared `writeOutbox(tx, {...})` **inside the same transaction** as the business fact, shaping the per-domain `event_id` (deterministic) + payload locally: `payment.captured/released/failed/refunded/disputed`; `negotiation_proposal_created/countered/rejected/accepted`; chat persisted message → `message-created`; `voip_calls` reaching `RINGING` → `call-invited`
    - No dependency on notifications; `EventEmitter2`/Centrifugo fast-paths remain unchanged
    - _Requirements: 2.1_ · _Design: Outbox in emitting domains_ · P2, P2b
  - [ ] 12.2 Migrate `offers` onto the outbox (remove direct `OneSignalClient.send`)
    - In `OfferNotificationService`, replace the direct `OneSignalClient.send` call with an `offer_outbox` write (`offer.matched/cancelled/expired/completed`) inside the offer business transaction; ensure the notifications `offer.*` mapper reproduces the same recipient/content/best-effort semantics so offer-radar behavior is preserved (no regression)
    - Remove now-unused offer-scoped push wiring only where fully superseded; keep offer-radar matching untouched
    - _Requirements: 2.6_ · _Design: offers migration_ · P13
  - [ ]* 12.3 Write unit tests for emitting-domain outbox writes
    - Each domain writes exactly one outbox row per fact with a deterministic `event_id`, in the same transaction; offers writes an `offer_outbox` row instead of calling OneSignal directly
    - _Requirements: 2.1, 2.6_

- [ ] 13. Checkpoint — Backend delivery + emitting-domain migration work end-to-end
  - Ensure all backend tests pass and offer-radar behavior is preserved; ask the user if questions arise.

- [ ] 14. Mobile — Store, types, API client, and bootstrap
  - [ ] 14.1 Create mobile notification types, constants, and API client
    - Create `apps/mobile/src/screens/notifications/notifications.types.ts`, `notifications.constants.ts` (ENDPOINTS, deep-link route map, i18n keys, `EXPO_PUBLIC_ONESIGNAL_APP_ID` reference), and `notifications.api.ts` (lazy `getApiClient()`; typed `registerDevice`, `updateConsent`, `unregisterDevice`, `getPreferences`, `updatePreferences`)
    - _Requirements: 5.1, 6.2_
  - [ ] 14.2 Implement `notifications.store.ts` (Zustand)
    - Create `apps/mobile/src/screens/notifications/notifications.store.ts`: device/permission state, preferences, and foreground-coordination bookkeeping (record shown realtime event ids so a redundant push for the same event is dismissed locally — fail-open, idempotent)
    - _Requirements: 4.3, 5.4_ · P10 (client side)
  - [ ] 14.3 Implement app bootstrap: permission request + OneSignal init + device registration
    - After auth, request notification permission at an appropriate moment, initialize the OneSignal SDK with `EXPO_PUBLIC_ONESIGNAL_APP_ID`, obtain the player id, and register the device (`POST /notifications/devices`) with `consent_granted` reflecting OS permission; permission-denied handled with an i18n explanation (never crash, never block app use)
    - _Requirements: 5.1, 6.2_
  - [ ]* 14.4 Write unit tests for store + bootstrap
    - Foreground dedup applied idempotently; permission-denied fallback registers with `consent_granted=false` and never crashes
    - _Requirements: 5.1, 5.4_

- [ ] 15. Mobile — Deep-link routing, incoming-call handoff, and settings
  - [ ] 15.1 Implement `useNotificationRouting`
    - Create `apps/mobile/src/screens/notifications/useNotificationRouting.ts`: parse the push `data` deep-link (`{ type, ...ids }`), route to the correct screen, and reconcile authoritative state via the owning module's `GET`
    - _Requirements: 5.2_ · P14
  - [ ] 15.2 Integrate incoming-call push with `IncomingCallSheet` (Spec 15 handoff)
    - Wire an `incoming_call` push to open the Spec 15 `IncomingCallSheet` (accept/decline) carrying `{ callId, conversationId }` and `GET`-reconcile the call
    - _Requirements: 5.3_ · P8, P14
  - [ ] 15.3 Implement `NotificationSettingsScreen`
    - Create `apps/mobile/src/screens/notifications/NotificationSettingsScreen.tsx`: toggle categories + quiet-hours window, persisted to `PUT /notifications/preferences`; en/es i18n parity; BidClean dark design tokens (`#00F5D4` accent, `#0B0C10`/`#1F2833` backgrounds); add `notifications` i18n namespace (en, es)
    - _Requirements: 5.4, 5.5_
  - [ ]* 15.4 Write mobile tests for routing + settings
    - `useNotificationRouting` maps each deep-link type to the right screen + `GET`; incoming-call push opens the sheet; settings persist categories/quiet-hours; i18n en/es parity (OneSignal SDK + apiClient mocked)
    - _Requirements: 5.2, 5.3, 5.4_

- [ ] 16. Checkpoint — Full notification UX integrated
  - Ensure mobile + backend integration works and CI backend jobs stay green; ask the user if questions arise.

- [ ] 17. Property-Based Tests — remaining invariants (fast-check)
  - [ ]* 17.1 Property test: deletion coherence (user-owned)
    - **Property 18: Deletion coherence (user-owned)**
    - **Validates: Requirements 7.2**
    - fast-check (≥100 iters): arbitrary user notification graphs → `ON DELETE CASCADE` removes devices/preferences/ledger; nothing preserved as shared history

- [ ] 18. Integration & Scenario Tests
  - [ ]* 18.1 Integration test: fact-in-TX → outbox → relay → PENDING → delivery → SENT
    - Emitting fact commits its outbox row atomically; relay creates PENDING intent; delivery worker sends (OneSignal mocked) → `SENT`
    - _Requirements: 2.1, 2.2, 3.1_
  - [ ]* 18.2 Integration test: crash-after-commit-before-relay recovery
    - Simulate a crash after the business+outbox commit but before relay → intent recovered on next drain (P2, P4)
    - _Requirements: 2.1, 2.5_
  - [ ]* 18.3 Integration test: offers migration behavior-preservation
    - `offer.matched` → `offer_outbox` → relay → same new-offer push recipient/content/best-effort as before (no offer-radar regression) (P13)
    - _Requirements: 2.6_
  - [ ]* 18.4 Integration test: incoming-call quiet-hours exemption
    - `call-invited` during the recipient's quiet hours → delivered anyway (EXEMPT/HIGH), honoring only a full unregister (P8)
    - _Requirements: 4.2, 5.3_
  - [ ]* 18.5 Integration test: signed webhook reconciles registry
    - Subscription-change callback (signed) → registry reconciled; duplicate `provider_event_id` → no-op (P16, P17)
    - _Requirements: 1.5, 6.4_
  - [ ]* 18.6 Integration test: user-deletion cascade
    - Deleting a user removes their `notification_devices`/`notification_preferences`/`notifications` rows via CASCADE (P18)
    - _Requirements: 7.2_

- [ ] 19. Documentation, ARCHITECTURE diagram, CHANGELOG, ADR, and .env.example
  - [ ] 19.1 Write module READMEs and note outbox additions in emitting modules
    - Create `services/api/src/notifications/README.md` and `apps/mobile/src/screens/notifications/README.md` (purpose, files table, dependencies, API, env vars) per documentation rules; add an outbox note to each emitting module's README (`offers`, `payments`, `negotiation`, `chat`, `voip-calls`) and a note to `packages/shared` for `OutboxWriter`
    - _Requirements: 6.5_
  - [ ] 19.2 Update `docs/ARCHITECTURE.md`, `.env.example`, and `docs/CHANGELOG.md`
    - Add the notifications module + a **notification flow** Mermaid diagram (fact → outbox → relay → intent → delivery → OneSignal) and the OneSignal transport node; add all `ONESIGNAL_*`, `NOTIFICATIONS_*`, and `EXPO_PUBLIC_ONESIGNAL_APP_ID` keys to `.env.example`; add `[Unreleased]` CHANGELOG entries
    - _Requirements: 6.1, 6.2, 6.5_
  - [ ] 19.3 Write the ADR
    - Create `docs/ADR/<NNN>-dedicated-notifications-module-onesignal-transport-durable-outbox.md` (Status/Context/Decision/Consequences) covering the dedicated notifications module + OneSignal-as-transport + durable-outbox event-driven-consumption decision
    - _Requirements: 6.5_

- [ ] 20. Final Checkpoint — All tests pass
  - Ensure all backend + mobile tests pass and CI backend jobs are green; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP (unit/property/integration tests and mobile tests)
- Each task references specific requirements and, where applicable, the design correctness property it implements
- Checkpoints ensure incremental validation
- Property-based tests (fast-check, ≥100 iterations, tagged `// Feature: push-notifications, Property N: <text>`) cover the pure decision/dedup/targeting logic: **P3, P6, P8, P9, P10, P12, P14, P17, P18**
- The notifications module **reacts, never a source of business truth**; the trigger contract is the durable transactional outbox, not `EventEmitter2`/Centrifugo
- Delivery **intent** is exactly-once in PostgreSQL (single-winner `PENDING → PROCESSING`); external OneSignal delivery is **at-least-once/best-effort** (mitigated by the provider idempotency key) — exactly-once end-to-end is not claimed
- Targeting is **per consented player id (Model B)** — never a blanket external-user-id fan-out
- The offers migration is **behavior-preserving** for offer-radar (REQ-NP13); the one change is writing an `offer_outbox` row instead of calling `OneSignalClient` directly
- `packages/shared` `OutboxWriter` stays **strictly domain-agnostic**; per-domain `event_id`/payload shaping lives in each emitting domain, and domain→intent mapping lives only in the notifications mappers
- All config comes from environment variables with fail-fast validation; the OneSignal REST key is server-only and never reaches the client
- All UI text uses i18n keys with en/es parity and BidClean dark design tokens

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "2.2", "2.3", "2.4", "2.5"] },
    { "id": 1, "tasks": ["3.1", "3.2", "3.3", "3.4"] },
    { "id": 2, "tasks": ["3.5", "4.1", "5.1"] },
    { "id": 3, "tasks": ["4.2", "4.3", "4.4", "5.2", "6.1"] },
    { "id": 4, "tasks": ["5.3", "5.4", "6.2", "9.1"] },
    { "id": 5, "tasks": ["6.3", "6.4", "6.5", "7.1", "9.2"] },
    { "id": 6, "tasks": ["7.2", "9.3", "9.4", "10.1", "10.2"] },
    { "id": 7, "tasks": ["10.3", "10.4", "11.1"] },
    { "id": 8, "tasks": ["11.2", "11.3", "11.4", "12.1"] },
    { "id": 9, "tasks": ["12.2", "12.3", "14.1"] },
    { "id": 10, "tasks": ["14.2", "14.3", "15.1"] },
    { "id": 11, "tasks": ["14.4", "15.2", "15.3"] },
    { "id": 12, "tasks": ["15.4", "17.1", "18.1", "18.2", "18.3", "18.4", "18.5", "18.6"] },
    { "id": 13, "tasks": ["19.1", "19.2", "19.3"] }
  ]
}
```
