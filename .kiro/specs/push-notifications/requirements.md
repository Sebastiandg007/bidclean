# Requirements Document

## Introduction

The `push-notifications` module gives BidClean a **single, first-class notification system** that reliably reaches a Host or Cleaner when the app is backgrounded or closed, and coordinates in-app alerts when it is open — so a user never misses a new offer, a counteroffer, an accepted match, a payment event, a new message, or an incoming call. It is Spec 16, the last of Sprint 4 (Communication).

**This spec consolidates rather than invents.** Push already exists in a limited, offer-scoped form: `OneSignalClient` and `OfferNotificationService` live inside the `offers` module, there is an `offer-push-notification` BullMQ queue, and offer alerts are sent best-effort to a Cleaner by external user id with `en`/`es` content. That works but is (a) coupled to one domain, (b) missing a durable device/subscription registry, (c) missing consumption of the many domain events other modules already emit, and (d) missing the delivery guarantees, user preferences, and deep-link routing a production notification layer needs. This spec extracts a dedicated **`notifications` module** that owns all of the above, **reuses the existing `OneSignalClient` behavior** (best-effort send by external user id, `en`/`es` content, BullMQ retries, graceful failure), and migrates the offers path onto it **without changing offer-radar behavior**.

The system is **event-driven and additive**, and — critically — its trigger source is a **durable transactional outbox, not an in-process event bus**. Other modules already emit typed domain events via `EventEmitter2` (`offer.*`, `payment.*`, `negotiation_proposal_*`) and publish realtime signals over Centrifugo (chat messages, `call_invite`); those remain, but they are **accelerators, not the delivery contract**. For a fact to be notification-worthy, the emitting domain writes a **durable outbox record in the same database transaction that commits the business fact** (after-commit-safe). A relay drains the outbox into notification intents. This closes the gap where a business fact commits but a crash (or an unavailable listener) means the notification is never created: because the outbox row is committed atomically with the fact, the intent is always recoverable. The notifications module **consumes** the outbox (with `EventEmitter2` as an optional low-latency fast-path that never replaces outbox durability); it never becomes a source of truth for offers, payments, negotiation, chat, or calls, and it never blocks or alters those flows. A failure to notify never fails the business action that triggered it.

**Chat and VoIP feed the outbox, not Centrifugo.** A persisted chat message emits a durable `message-created` outbox record, and a call reaching `RINGING` emits a durable `call-invited` outbox record. Centrifugo is realtime *transport*; it is never the event bus of the push system. Push triggering for messages and calls derives from the durable record, so a dropped Centrifugo frame never means a missed background notification.

**Authority split (kept strict):**
- **The emitting domain module is the source of truth for the fact.** An offer was matched, a payment was released, a message was sent, a call is ringing — those facts live in their own tables and are authoritative there. The notifications module only *reacts* to them.
- **PostgreSQL is the source of truth for notification delivery intent and device registry.** The emitting domain's **outbox** (durable trigger), a `notifications` ledger row (recipient, type, payload reference, dedup key, channel, status), and a `notification_devices` / subscription registry are the authoritative notification-side records. Notification *content* is derived and localized, never a source of business truth. **Delivery intent is deduplicated exactly-once in PostgreSQL; external delivery is at-least-once/best-effort** (a single push is never *guaranteed* exactly-once end-to-end — see the correctness properties).
- **OneSignal is the delivery transport for background/closed-app push.** It owns device tokens, OS-level delivery (APNs/FCM), and journeys/segments. **Device-level consent is honored by targeting individual player/subscription ids (Model B):** the delivery worker sends to the specific consented player ids resolved from the registry, not by a blanket external-user-id fan-out — so an opted-out device on a user with other consented devices is never reached. The internal user id is still associated as the OneSignal external user id (the pattern in `OneSignalClient`) for segmentation/tags, but *targeting for a given send is per-consented-device*. OneSignal player ids and OS tokens never become BidClean identifiers.
- **OneSignal is kept always-synchronized (first-class transport).** The registry and OneSignal are reconciled **bidirectionally**: registry changes are pushed to OneSignal (external-user-id association + tags), OneSignal subscription webhooks reconcile back into the registry, and a bounded periodic reconciliation sweep repairs any drift. Model B relies on this sync being correct: a stale/invalid player id is never repeatedly targeted, and a consented device is never silently unreachable. OneSignal delivery quality (correct tokens, correct segments, correct consent) is a hard operational requirement, not best-effort bookkeeping.
- **Centrifugo remains the in-app (foreground) realtime channel.** When the app is open, in-app banners/toasts come from the realtime signals the app already receives; push is the background/closed-app path. The two are coordinated so a foregrounded user is not double-notified — but this coordination is **fail-open, not a correctness guarantee**: if foreground status cannot be reliably determined, the system delivers the push rather than risk suppressing an important background notification. Preferred suppression is **client-side** (the foregrounded app, which received the realtime alert, dismisses/deduplicates the redundant push locally); an optional server-side foreground-ack/presence signal MAY assist but its absence never suppresses. Messages and calls in particular always fail open.

**Ownership boundary — notifications vs. emitting domains vs. OneSignal:**
- The **`notifications` module (new)** owns: the device/subscription registry, the notification ledger + dedup/idempotency, the event listeners that map domain events to notification intents, the localized content catalog, per-user preferences/quiet-hours, deep-link routing metadata, the BullMQ delivery worker, and the OneSignal webhook ingress (delivery/subscription-change callbacks). It holds `OneSignalClient` (moved/generalized from `offers`).
- **Emitting modules** (`offers`, `payments`, `negotiation`, `chat`, `voip-calls`) keep emitting their existing domain events unchanged; they gain **no** dependency on notifications. The one migration is that `offers` stops calling `OneSignalClient` directly and instead relies on the notifications module's listener for `offer.*` (behavior preserved).
- **OneSignal** owns device tokens and OS delivery. It never learns BidClean business rules; it receives a localized payload + an external user id + a deep-link data blob.

**Incoming-call handoff from Spec 15 (the deferred piece).** `voip-calls` deliberately deferred *waking a backgrounded/killed app for an incoming call*. This spec owns that: a `call_invite` (ringing) for a participant whose app is not foregrounded is delivered as a **high-priority call push** carrying the `callId`/`conversationId` deep-link so the app can open the incoming-call UI and reconcile via `GET`. OS-level call screens (CallKit / ConnectionService) are integrated **only to the extent OneSignal + Expo support** for the MVP; full native call-kit UX beyond that is a documented enhancement, not a hard requirement — but the call push itself and its deep-link ARE in scope.

**Deliberate scope boundaries (to keep the MVP correct and shippable):**
- **Additive and best-effort.** Notifications never block, delay, or alter the business action that triggered them; a notification failure is swallowed and, where it matters, retried by BullMQ. No business transaction depends on a push succeeding.
- **Push transport is OneSignal only.** No direct APNs/FCM integration, no SMS, no email in this spec (email/SMS are separate future channels). The ledger models a `channel` column so future channels are additive, but only `PUSH` (OneSignal) and the coordination with in-app realtime are implemented.
- **Foreground alerts reuse existing realtime.** This spec does not build a new in-app toast transport; it coordinates with the Centrifugo signals the app already consumes so foreground users see in-app alerts and are not also hit with a redundant push.
- **Content localization uses the existing `en`/`es` catalog approach**, elevated to a per-type localized catalog with `en`/`es` parity; it does not introduce runtime machine translation of notification text.
- **Journeys/segments are configured in OneSignal, driven by tags this spec sets** (role, subscription, country, language, verified, last_active). This spec owns *setting the tags and emitting the trigger events*; it does not re-implement OneSignal's journey engine.
- **No notification inbox/history UI as a hard requirement.** The durable ledger exists for delivery correctness, dedup, and audit; a user-facing in-app notification center is out of scope for v1 (the ledger makes it a later, additive feature).
- **No read receipts / open-tracking as correctness.** OneSignal open/click callbacks may update the ledger status opportunistically, but no business logic depends on whether a notification was opened.
- **Delivery is not guaranteed real-time or exactly-once end-to-end.** As with chat/voip, correctness rests on idempotent dedup keys, a durable ledger, BullMQ retries, and the fact that the authoritative state is always re-derivable in-app via `GET` — not on any single push arriving.

## Domain Model Overview

```
EMITTING DOMAINS (unchanged sources of truth) — write a DURABLE OUTBOX ROW in the SAME
transaction that commits the business fact (after-commit-safe). EventEmitter2/Centrifugo are
optional low-latency fast-paths, NOT the delivery contract.
  offers        : offer.matched / cancelled / expired / completed        → outbox
  payments      : payment.captured / released / failed / refunded / disputed → outbox
  negotiation   : negotiation_proposal_created / countered / rejected / accepted → outbox
  chat          : message-created (durable, NOT the Centrifugo frame)     → outbox
  voip-calls    : call-invited (RINGING, durable, NOT the Centrifugo frame)→ outbox  ──► incoming-call push
        │  outbox relay (drains committed rows; each row carries a durable event_id + version)
        ▼
notifications module (NEW — reacts, never a source of business truth)
  OutboxRelay/Listeners  → map an outbox event to a NotificationIntent { recipientUserId, type,
                            dedupKey (derived from event_id), deepLink, localizedContentRef,
                            priority, category }
  NotificationService    → dedup by dedupKey (UNIQUE, exactly-once intent) → persist ledger (PENDING)
                            → evaluate preferences/quiet-hours/consent using NotificationType metadata
                            → enqueue delivery
  DeliveryWorker (BullMQ)→ single-winner PENDING→PROCESSING → resolve the recipient's CONSENTED
                            player ids (Model B, per-device) → OneSignalClient.send (per-device;
                            en/es content; deep-link data; provider idempotency key where supported)
                            → SENT / FAILED_RETRYABLE (retry) / FAILED_FINAL
  OneSignalWebhook       → delivery + subscription-change callbacks (provider_event_id UNIQUE,
                            idempotent) → update ledger / registry
        │
        ▼
PERSISTENCE (PostgreSQL — notification-side source of truth)
  <domain>_outbox (per emitting domain, or a shared outbox): event_id (UNIQUE), aggregate ref,
                              type, payload, version, created_at, relayed_at (nullable) — committed
                              WITH the business fact; drained by the relay; enables recovery
  notification_devices      : id, user_id (FK → users ON DELETE CASCADE), platform (IOS|ANDROID|WEB),
                              onesignal_player_id (subscription id — the per-device target),
                              onesignal_external_user_id (= internal user_id, for tags/segments),
                              consent_granted (bool), last_seen_at, created_at/updated_at
                              (UNIQUE (user_id, onesignal_player_id))
  notification_preferences  : user_id (FK CASCADE), per-category opt-in/out, quiet_hours window + tz,
                              language, created_at/updated_at
  notifications (ledger)    : id, recipient_user_id (FK → users ON DELETE CASCADE), type, category,
                              channel (PUSH), dedup_key (UNIQUE), deep_link, payload_ref, priority,
                              status (PENDING|PROCESSING|SENT|FAILED_RETRYABLE|FAILED_FINAL|SUPPRESSED),
                              suppression_reason (nullable), attempt, created_at/updated_at,
                              sent_at (nullable)   (NO deleted_at; hard-delete via retention window)

TRANSPORT
  OneSignal  : device tokens, APNs/FCM, journeys/segments (tags set by this module). Targeting for a
               send is PER CONSENTED player id (Model B). Player ids / OS tokens are NEVER BidClean ids.
  Centrifugo : in-app foreground alerts (existing signals). Foreground de-dup is FAIL-OPEN and
               preferably client-side; it never suppresses when foreground status is unknown.

DELIVERY DECISION (per intent)
  outbox event → intent → dedup(dedupKey from event_id): already-present → no-op (exactly-once intent)
         → NotificationType metadata (priority/category/quietHoursBehavior/defaultEnabled) +
           user preferences/consent: opted-out/quiet → ledger SUPPRESSED(reason), no send
         → foreground (fail-open, client-preferred): suppress redundant push ONLY when reliably known
         → else → PENDING → single-winner PROCESSING → per-consented-device OneSignal send
                 → SENT / FAILED_RETRYABLE (BullMQ retry) / FAILED_FINAL
  Incoming call (call-invited): priority=HIGH, quietHoursBehavior=EXEMPT; always attempts a call push
         (respecting only a full device unregister) with { callId, conversationId } deep-link so the
         app opens the incoming-call UI and GET-reconciles.
  External delivery is at-least-once/best-effort; provider-side idempotency is used where supported.
```

- A **notification** is a durable ledger row created in reaction to a **durable outbox event**; it references the fact by a **dedup key derived from the outbox `event_id`** (e.g. `offer.matched:{offerId}:{recipientUserId}`) so the same event never produces two *intents* even under redelivery or worker races. (External *delivery* is at-least-once — the exactly-once guarantee is on the intent, not the push.)
- **Device registry** maps an internal `userId` to its per-device OneSignal **player id** + platform + `consent_granted`; a user may have multiple devices, each independently consented. Sends target the consented player ids (Model B). Deleting a user cascades their devices/preferences/ledger (notification data is user-owned, not shared history — unlike chat/calls — so CASCADE from `users` is correct here).
- **Delivery is best-effort with a durable, recoverable trigger.** The outbox row is committed *with the business fact*; the intent (ledger row) is deduped and committed before enqueue; OneSignal send is per-device and BullMQ-retried; the authoritative business state is always re-derivable in-app via the owning module's `GET`.
- **Both roles** get role-appropriate notifications (Cleaner: new offer, accepted, payment released, message, incoming call; Host: counteroffer, cleaner-on-the-way/arrived later specs, payment captured/refunded, message, incoming call), gated by preferences and localized `en`/`es`.

## Glossary

- **Outbox** — a durable table (per emitting domain, or shared) written in the **same transaction** as the business fact, carrying a `UNIQUE event_id` + version; drained by a relay into notification intents. The recoverable trigger source (not `EventEmitter2`, not Centrifugo).
- **Outbox relay** — the component that drains committed-but-unrelayed outbox rows into notification intents, at-least-once, marking rows `relayed_at`; idempotent via the intent dedup key.
- **Notification intent** — the internal record of "we should notify user X about event Y", persisted as a `notifications` ledger row (deduped by the outbox `event_id`) before any transport call.
- **Dedup key** — a deterministic key derived from the outbox `event_id` + recipient, `UNIQUE` in the ledger, making intent creation exactly-once under redelivery or worker races.
- **NotificationType metadata** — each type declares `{ priority, category, quietHoursBehavior, defaultEnabled }` (config-driven), so delivery decisions read metadata instead of branching on `if incoming_call`.
- **Device / subscription registry** — `notification_devices`: which OneSignal **player ids** (per-device subscription targets) + platforms + `consent_granted` belong to a user.
- **External user id** — the OneSignal external user id associated with a device; it is the **internal BidClean `userId`** (the pattern in `OneSignalClient`), used for tags/segments. Per-send *targeting* is by consented **player id** (Model B), not a blanket external-user-id fan-out. Player ids / OS tokens are never BidClean identifiers.
- **provider_event_id** — the OneSignal webhook's own event identifier, stored `UNIQUE`, so a redelivered callback never re-mutates the ledger/registry.
- **Channel** — the delivery medium; only `PUSH` (OneSignal) is implemented, modeled so email/SMS are additive later.
- **Preferences / quiet hours** — per-user, per-category opt-in/out and a do-not-disturb window (with timezone); suppress non-urgent pushes, never suppress a high-priority incoming-call push.
- **Foreground coordination** — the rule that a user with the app open (receiving the in-app realtime alert) is not also sent a redundant background push for the same event.
- **Incoming-call push** — the Spec 15 handoff: a high-priority, quiet-hours-exempt push for a `call_invite` to a non-foregrounded participant, carrying the deep-link to open the incoming-call UI.
- **Tag** — a OneSignal segmentation attribute this module sets (role, subscription, country, language, verified, last_active) that drives OneSignal-configured journeys/segments.

## Requirements

### Requirement 1 — Device & subscription registry

**User Story:** As a signed-in user, I want my device registered for notifications, so that the platform can reach me on the right device with my consent respected.

#### Acceptance Criteria

1. WHEN an authenticated client registers a device THEN the system SHALL upsert a `notification_devices` row keyed by `(user_id, onesignal_player_id)` with `platform`, `consent_granted`, and `last_seen_at`, and SHALL associate the internal user id as the OneSignal external user id (for tags/segments only).
2. WHEN a user registers devices on multiple platforms THEN the system SHALL retain one row per device (per player id), and on send SHALL target **only the consented player ids individually (Model B)** — never a blanket external-user-id fan-out — so an opted-out device belonging to a user with other consented devices is never reached.
3. WHEN a client updates consent or unregisters (logout) THEN the system SHALL update `consent_granted` / remove the corresponding registry row so that specific device is no longer targeted, without affecting the user's other devices.
4. WHEN a device registration is requested by a non-authenticated caller or for a different user id than the JWT subject THEN the system SHALL reject it (`401`/`403`) and register nothing.
5. WHEN the OneSignal webhook reports a subscription change (unsubscribe, token invalidation, player-id change) THEN the system SHALL update the registry idempotently so stale devices are not targeted.
6. WHEN the BidClean registry and OneSignal state could diverge THEN the system SHALL keep them **bidirectionally synchronized** and treat OneSignal as a first-class, always-working transport: (a) on device register/consent change, the registry SHALL push the authoritative state to OneSignal (external user id association + tags), and (b) OneSignal subscription-change webhooks SHALL reconcile back into the registry (idempotent via `provider_event_id`). A **periodic reconciliation sweep** (bounded, configurable) SHALL detect and repair drift (registry devices missing/invalid in OneSignal and vice-versa), so a send never targets a stale player id and a consented device is never silently unreachable.
7. WHEN OneSignal targeting is performed THEN the registry's set of consented player ids SHALL be the reconciled source used for per-device sends (Model B), and any player id OneSignal reports as invalid SHALL be marked stale in the registry rather than repeatedly retried.

### Requirement 2 — Durable outbox-driven notification intents

**User Story:** As a user, I want to be reliably notified about the things that matter (offers, matches, counteroffers, payments, messages, calls) even if a process crashes at the wrong moment, so that I never silently miss an event.

#### Acceptance Criteria

1. WHEN an emitting domain commits a notification-worthy business fact (`offer.matched/cancelled/expired/completed`; `payment.captured/released/failed/refunded/disputed`; `negotiation_proposal_created/countered/rejected/accepted`; a persisted chat message → `message-created`; a call reaching `RINGING` → `call-invited`) THEN it SHALL write a **durable outbox row in the same transaction as the business fact**, carrying a `UNIQUE event_id`, aggregate reference, type, payload, and version. `EventEmitter2`/Centrifugo MAY additionally fire as a low-latency fast-path but SHALL NOT be the sole trigger.
2. WHEN the outbox relay drains a committed outbox row THEN it SHALL map it to a `NotificationIntent { recipientUserId, type, category, dedupKey (from event_id), deepLink, localizedContentRef, priority }` and persist a `notifications` ledger row (status `PENDING`) with its `dedup_key` BEFORE enqueuing delivery (durable-first), so a crash between persist and enqueue is recoverable and the relay is safely at-least-once.
3. WHEN the same outbox event is relayed more than once or two relays/workers race THEN the `UNIQUE dedup_key` (derived from `event_id`) SHALL guarantee **at most one ledger row (exactly-once intent)**, and a duplicate SHALL be a no-op — never a second intent. (External delivery remains at-least-once; see Req 3.)
4. WHEN mapping an event whose recipient has no consented device THEN the system SHALL still persist the ledger row (audit) and mark it `SUPPRESSED` (no-device) without error, never throwing into the emitting flow.
5. WHEN a relay/listener throws or the notifications module is unavailable THEN the emitting domain action SHALL be entirely unaffected — the outbox row is already committed with the fact, so the intent is created later on recovery; the notifications side is fully isolated from the source transaction.
6. WHEN the existing `offers` push path is migrated onto this module THEN offer-radar delivery behavior (who gets the new-offer push, content, best-effort semantics) SHALL be preserved — no regression to offer-radar; `offers` writes an outbox row instead of calling `OneSignalClient` directly.

### Requirement 3 — Delivery via OneSignal (reuse existing client, best-effort, retryable)

**User Story:** As the platform, I want pushes delivered reliably-enough and never harmfully, so that users are reached without the system depending on any single send.

#### Acceptance Criteria

1. WHEN a `PENDING` notification is delivered THEN a BullMQ worker SHALL first single-winner transition it `PENDING → PROCESSING` (so only one worker delivers a given row), resolve the recipient's **consented player ids**, and call `OneSignalClient` **per consented player id** with localized `en`/`es` `headings`/`contents`, a `data` deep-link payload, and a **provider idempotency key where OneSignal supports one**, then mark the ledger `SENT` (or `FAILED_RETRYABLE`/`FAILED_FINAL`).
2. WHEN OneSignal is misconfigured, times out, or returns an error THEN delivery SHALL fail gracefully (logged, ledger `FAILED_RETRYABLE` and BullMQ-retried, or `FAILED_FINAL` when retries are exhausted), SHALL NOT throw into any business flow, and SHALL NOT lose the ledger row — mirroring the current `OneSignalClient` behavior. External delivery is **at-least-once/best-effort**; a crash after OneSignal accepts but before `SENT` is written MAY cause a redelivery, mitigated by the provider idempotency key.
3. WHEN a notification is delivered THEN its `data` payload SHALL carry a deep-link (type + entity id, e.g. `{ type: 'offer_matched', offerId }` / `{ type: 'incoming_call', callId, conversationId }`) so the app can route to the right screen and reconcile via `GET`.
4. WHEN content is rendered THEN it SHALL come from a per-type localized catalog with `en` and `es` in parity, none hardcoded in delivery logic (elevating the existing `NOTIFICATION_CONTENT` approach).
5. WHEN no consented, valid device exists for the recipient THEN the worker SHALL mark the ledger `SUPPRESSED`/no-device and SHALL NOT call OneSignal.

### Requirement 4 — Preferences, quiet hours, and foreground coordination

**User Story:** As a user, I want control over what notifications I get and when, and I don't want to be double-notified, so that notifications are helpful, not noisy.

#### Acceptance Criteria

1. WHEN a delivery decision is made THEN it SHALL be driven by **`NotificationType` metadata** — each type declares `{ priority, category, quietHoursBehavior, defaultEnabled }` (config-driven) — rather than by branching on specific type names in logic; a type whose `quietHoursBehavior` is `RESPECT` and that violates the user's quiet-hours/opt-out is `SUPPRESSED` without sending.
2. WHEN a notification's `NotificationType` metadata has `priority = HIGH` and `quietHoursBehavior = EXEMPT` (e.g. `call-invited`) THEN it SHALL be exempt from quiet hours and non-urgent opt-outs (a ringing call must reach the user), while still respecting a full device-level unregister/consent withdrawal.
3. WHEN the recipient's app is foregrounded THEN suppression of a redundant background push SHALL be **fail-open**: the push is suppressed ONLY when foreground status is reliably known (preferably via client-side dedup by the app that received the realtime alert; optionally aided by a server-side foreground-ack). When foreground status is unknown, the push SHALL be delivered — messages and calls always fail open — so an important background notification is never silently dropped.
4. WHEN preferences are absent THEN the system SHALL apply the `defaultEnabled` from each `NotificationType`'s metadata (transactional/urgent on, marketing/journey off unless opted-in), documented in config, none hardcoded in logic.
5. WHEN a suppression decision is made THEN it SHALL be recorded on the ledger row (`SUPPRESSED` + `suppression_reason`) for audit, and SHALL never be reported as a failure.

### Requirement 5 — Mobile notification UX

**User Story:** As a Host or Cleaner, I want notifications to arrive, open the right screen, and respect my settings, so that they help me act quickly.

#### Acceptance Criteria

1. WHEN the app starts and the user is authenticated THEN the app SHALL request notification permission at an appropriate moment, register the device (OneSignal + backend registry), and handle permission-denied gracefully with an i18n explanation (never crash, never block app use).
2. WHEN a push is received while the app is backgrounded/closed and the user taps it THEN the app SHALL deep-link to the correct screen using the `data` payload and reconcile authoritative state via the owning module's `GET`.
3. WHEN an incoming-call push arrives THEN the app SHALL open the incoming-call UI (accept/decline) and reconcile the call via `GET` (Spec 15), so a backgrounded user can receive a call.
4. WHEN the app is foregrounded THEN in-app alerts SHALL come from the existing realtime signals (banner/toast), coordinated so the same event is not shown twice.
5. WHEN the user opens notification settings THEN the app SHALL let them toggle categories and quiet hours, persisted to the backend preferences, with `en`/`es` parity and BidClean dark design tokens.

### Requirement 6 — Configuration, security, and no hardcoded values

**User Story:** As an operator, I want notification behavior and OneSignal credentials driven by configuration, so that the feature is portable and leaks no secrets.

#### Acceptance Criteria

1. WHEN the module reads any tunable (`ONESIGNAL_APP_ID`, `ONESIGNAL_API_KEY`, `ONESIGNAL_API_URL`, `ONESIGNAL_TIMEOUT_MS`, `ONESIGNAL_WEBHOOK_*` secret, delivery retry/backoff, `NOTIFICATIONS_RECONCILE_INTERVAL_MS`/`NOTIFICATIONS_RECONCILE_BATCH_SIZE` for the OneSignal sync sweep, `NOTIFICATIONS_RETENTION_DAYS`, default preferences, quiet-hours defaults) THEN it SHALL come from environment/config constants with none hardcoded in logic, and a fail-fast `validateNotificationsConfig()` SHALL run at startup for required values.
2. WHEN the OneSignal REST API key is used THEN it SHALL live only in server configuration and never reach the client; the mobile app SHALL use only the public OneSignal app id via `EXPO_PUBLIC_ONESIGNAL_APP_ID`.
3. WHEN notification content or logs are produced THEN they SHALL NOT contain secrets or unnecessary PII (no raw tokens, no message bodies in logs), and deep-link payloads SHALL carry ids, not sensitive content.
4. WHEN the OneSignal webhook is received THEN it SHALL be authenticated (signature/secret over the raw body — mirroring the Stripe/RevenueCat webhook pattern), SHALL reject unauthenticated callbacks, and SHALL be idempotent via a stored `provider_event_id UNIQUE` so a redelivered callback never re-mutates the ledger/registry.
5. WHEN a new module, migration, event listener, OneSignal integration surface, or mobile feature is introduced THEN it SHALL be documented (module READMEs, ARCHITECTURE diagram + a notification flow, CHANGELOG, and an ADR for the dedicated notifications module + OneSignal-as-transport + event-driven-consumption decision) per the project documentation rules.

### Requirement 7 — Persistence, lifecycle, and integrity

**User Story:** As the platform, I want notification data modeled and cleaned up correctly, so that delivery is idempotent, auditable, and privacy-respecting.

#### Acceptance Criteria

1. WHEN the notification tables are created THEN they SHALL follow the project database standards: UUID PKs, snake_case, `timestamptz`, explicit FK `ON DELETE` behavior, application-validated `VARCHAR` for `type`/`status`/`channel`/`platform`/`category` (not PG enums), a `UNIQUE dedup_key` on the ledger, a `UNIQUE event_id` on the outbox, a `UNIQUE provider_event_id` for webhook dedup, and indexes on every FK and on `(recipient_user_id, created_at)` and `(status)` for the delivery worker; the ledger `status` SHALL be one of `PENDING|PROCESSING|SENT|FAILED_RETRYABLE|FAILED_FINAL|SUPPRESSED`.
2. WHEN a user account is deleted THEN their `notification_devices`, `notification_preferences`, and `notifications` ledger rows SHALL be `ON DELETE CASCADE` from `users` — notification data is user-owned and not shared history (this is the deliberate difference from chat/calls, where participant FKs are SET NULL to preserve shared history).
3. WHEN the ledger grows THEN a **configurable retention window** SHALL allow hard-pruning old terminal rows (`SENT`/`FAILED_FINAL`/`SUPPRESSED`) beyond a documented horizon. Dedup correctness holds **within the retention window**; because each intent's `dedup_key` derives from the durable outbox `event_id` + version, a replay of a still-relevant event is deduped, while a replay of an event older than the retention horizon is accepted by design (documented tradeoff).
4. WHEN a notification is created THEN it SHALL be immutable except for its delivery lifecycle fields (`status`, `attempt`, `sent_at`, `suppression_reason`); there SHALL be no `deleted_at` (hard-delete via the retention window, per the standards for disposable-but-auditable data).
5. WHEN concurrent delivery attempts occur for one ledger row THEN status transitions SHALL be safe (a single-winner conditional update `PENDING → PROCESSING`), so one row is never picked up by two workers; note this bounds **local** double-processing — external OneSignal delivery remains at-least-once (mitigated by the provider idempotency key), never claimed as exactly-once.

## Correctness Properties (business invariants)

The design defines concrete, testable properties (its own numbering) mapping back to these.

- **REQ-NP1 — Additive & non-blocking.** No business action (offer, payment, negotiation, chat, call) is ever failed, delayed, or altered by notification logic; the outbox write is part of the business transaction, and all downstream relay/transport failures are isolated and swallowed. *(Req 2.1, 2.5, 3.2)*
- **REQ-NP2 — Durable outbox trigger + exactly-once intent.** The trigger is a durable outbox row committed **in the same transaction as the business fact** (never solely `EventEmitter2`/Centrifugo), so a fact can never exist without a recoverable notification trigger; the relay is at-least-once and the ledger's `UNIQUE dedup_key` (from `event_id`) makes the *intent* exactly-once. *(Req 2.1, 2.2, 2.3, 7.5)*
- **REQ-NP2b — Chat/VoIP triggers are durable, not Centrifugo frames.** A `message-created` / `call-invited` outbox row is the push trigger; a dropped Centrifugo frame never causes a missed background notification. *(Req 2.1)*
- **REQ-NP3 — Best-effort delivery, recoverable truth.** OneSignal send is best-effort + BullMQ-retried; delivery is never guaranteed real-time/exactly-once, and authoritative business state is always re-derivable in-app via the owning module's `GET`. *(Req 3.1, 3.2)*
- **REQ-NP4 — Per-device consent targeting (Model B).** Sends target the recipient's individually consented player ids, not a blanket external-user-id fan-out; an opted-out device on a multi-device user is never reached. The internal `userId` is the external user id for tags/segments only; player ids / OS tokens never become BidClean identifiers. *(Req 1.1, 1.2, 1.3, 3.1)*
- **REQ-NP5 — Consent & metadata-driven preferences; urgent calls exempt.** Delivery decisions read `NotificationType` metadata (`priority/category/quietHoursBehavior/defaultEnabled`); a `RESPECT` type violating quiet-hours/opt-out is `SUPPRESSED` without sending; an `EXEMPT`/`HIGH` type (incoming call) bypasses quiet-hours/non-urgent opt-outs but still respects a full device unregister. *(Req 4.1, 4.2, 4.4)*
- **REQ-NP6 — No double-notify, fail-open.** A foregrounded user who reliably received the in-app realtime alert is not also sent a redundant background push; but foreground de-dup is **fail-open** — when foreground status is unknown the push is delivered, and messages/calls always fail open, so an important notification is never silently suppressed. Preferred de-dup is client-side. *(Req 4.3)*
- **REQ-NP7 — Deep-link routing.** Every push carries a typed id-based deep-link enabling the app to route and reconcile; no sensitive content is placed in the payload. *(Req 3.3, 5.2, 5.3)*
- **REQ-NP8 — Incoming-call handoff (Spec 15).** A `call_invite` to a non-foregrounded participant produces a high-priority call push with `{ callId, conversationId }` so the app can open the incoming-call UI and `GET`-reconcile. *(Req 2.1, 4.2, 5.3)*
- **REQ-NP9 — Localization parity.** All notification content comes from a per-type catalog with `en`/`es` parity, none hardcoded in delivery logic. *(Req 3.4)*
- **REQ-NP10 — Deletion coherence (user-owned).** Deleting a user CASCADE-deletes their devices/preferences/ledger; notification data is not shared history (the deliberate contrast with chat/calls SET NULL). *(Req 7.2)*
- **REQ-NP11 — Exactly-once intent, at-least-once delivery.** The *intent* is deduplicated exactly-once in PostgreSQL (single-winner `PENDING → PROCESSING` so one worker owns a row); **external OneSignal delivery is at-least-once/best-effort** and a provider idempotency key is used where supported. Exactly-once end-to-end push delivery is explicitly NOT claimed. *(Req 3.1, 3.2, 7.5)*
- **REQ-NP14 — Webhook idempotency.** OneSignal callbacks are authenticated and deduped by `provider_event_id UNIQUE`; a redelivered callback never re-mutates the ledger/registry. *(Req 6.4)*
- **REQ-NP15 — OneSignal always synchronized.** The registry and OneSignal are kept bidirectionally in sync (register/consent → push to OneSignal; webhook → reconcile back; periodic bounded sweep repairs drift). A send never targets a stale/invalid player id, and a consented device is never silently unreachable — OneSignal is a first-class, always-working transport, not best-effort bookkeeping. *(Req 1.5, 1.6, 1.7)*
- **REQ-NP12 — No hardcoded config/secrets.** OneSignal keys/URL/timeouts, retry/backoff, and default preferences come from config with fail-fast validation; the REST key never reaches the client; secrets/PII never logged; the webhook is signature-authenticated. *(Req 6.1–6.4)*
- **REQ-NP13 — Offers migration is behavior-preserving.** Moving the offer push path onto the notifications module does not change offer-radar delivery behavior. *(Req 2.6)*

## Non-Goals

- A new source of truth for offers, payments, negotiation, chat, or calls — notifications only react to their events.
- Direct APNs/FCM integration, SMS, or email channels (the ledger models `channel` for future additivity; only OneSignal `PUSH` + in-app coordination are implemented).
- A new in-app toast/banner transport — foreground alerts reuse the existing realtime signals.
- Runtime machine translation of notification text (a per-type `en`/`es` catalog is used).
- Re-implementing OneSignal's journey/segment engine — this module sets tags and emits triggers; journeys are configured in OneSignal.
- A user-facing notification inbox/history UI (the ledger exists for correctness/audit; an inbox is a later additive feature).
- Read-receipt/open-tracking as business correctness (open callbacks may update the ledger opportunistically only).
- Full native CallKit/ConnectionService UX beyond what OneSignal + Expo support for the MVP (the incoming-call push + deep-link ARE in scope; deeper OS call integration is a documented enhancement).
- Any change to the offer/negotiation/payment/chat/voip contracts beyond adding best-effort event consumption and migrating the existing offers push onto this module without behavior change.
