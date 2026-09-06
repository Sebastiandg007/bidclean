# ADR-013: Dedicated Notifications Module — Durable Transactional Outbox Trigger, OneSignal as Transport, Exactly-Once Intent / At-Least-Once Delivery

## Status
Accepted

## Context
Spec 16 (`push-notifications`) needed a single, first-class notification system that reliably reaches a Host or Cleaner when the app is backgrounded/closed and coordinates with in-app realtime alerts when it is open. Push already existed in a limited, offer-scoped form (`OneSignalClient` + `OfferNotificationService` inside `offers`, an `offer-push-notification` BullMQ queue). Several decisions had to be settled before implementation:

- **What triggers a notification** — the in-process event bus (`EventEmitter2`) / Centrifugo, or something durable — and what delivery guarantee (if any) is claimed.
- **What is authoritative** for notification delivery intent and the device registry.
- **How a single push is targeted** across a user's multiple devices with per-device consent.
- **How OneSignal stays synchronized** so a send never targets a stale player id and a consented device is never silently unreachable.
- **How the existing offers push path migrates** without changing offer-radar behavior.

## Decision
1. **The trigger is a durable transactional outbox, not the event bus.** For a fact to be notification-worthy, the emitting domain writes a `<domain>_outbox` row **in the same transaction that commits the business fact** (`event_id` UNIQUE, version, payload). A relay drains committed-but-unrelayed rows into notification intents. `EventEmitter2`/Centrifugo remain optional low-latency fast-paths that never replace outbox durability. This closes the gap where a business fact commits but a crash means the notification is never created.
2. **PostgreSQL is the source of truth for notification delivery intent + device registry.** The `notifications` ledger (`dedup_key` UNIQUE → exactly-once *intent*), `notification_devices` (Model B per-device consent), and `notification_preferences` are authoritative on the notification side. Notification content is derived and localized, never business truth.
3. **Delivery intent is exactly-once; external delivery is at-least-once/best-effort.** A single-winner conditional update (`UPDATE ... WHERE id=:id AND status='PENDING'`) means one worker owns a ledger row. External OneSignal delivery is at-least-once, mitigated by a provider idempotency key. Exactly-once end-to-end push is explicitly NOT claimed — the ledger grain is per intent, not per device, so a retry MAY re-hit an already-delivered device.
4. **OneSignal is a first-class, always-synchronized transport, targeted per consented device (Model B).** A send targets the recipient's individually consented, non-stale player ids — never a blanket external-user-id fan-out — so an opted-out device on a multi-device user is never reached. The internal user id is the OneSignal external user id for tags/segments only. The registry and OneSignal are reconciled bidirectionally: register/consent pushes state to OneSignal, subscription webhooks reconcile back (deduped by `provider_event_id` UNIQUE), and a bounded periodic sweep repairs drift.
5. **Delivery decisions are metadata-driven, calls exempt, foreground de-dup fail-open.** Each `NotificationType` declares `{ priority, category, quietHoursBehavior, defaultEnabled }`; the pure `PreferenceService.decide()` reads that metadata instead of branching on type names. `EXEMPT`/`HIGH` (incoming call) bypasses quiet hours and non-urgent opt-outs (still honoring a full device unregister). Foreground suppression happens only when foreground status is reliably known; messages and calls always fail open.
6. **Notification data is user-owned (CASCADE), the deliberate contrast with chat/voip.** `notification_devices`, `notification_preferences`, and `notifications` are `ON DELETE CASCADE` from `users`. This differs intentionally from chat/voip participant FKs (`SET NULL`, preserving shared history) because notification data is not shared history.
7. **The offers migration is behavior-preserving.** Moving the offer push path onto this module changes only the mechanism (an `offer_outbox` write instead of a direct `OneSignalClient.send`); the offer-radar new-offer push recipient/content/best-effort semantics are preserved.

## Reasoning
- **Durability over delivery.** Committing the outbox row atomically with the fact makes the intent always recoverable; the relay is at-least-once and the ledger `dedup_key` makes the intent exactly-once. An unavailable notifications side never blocks or alters the business action.
- **Honest guarantees.** Claiming exactly-once end-to-end push would be false: OS-level delivery and retries are inherently at-least-once. Encoding this (per-intent ledger + provider idempotency key) keeps the contract truthful and testable.
- **Model B is the only way to honor per-device consent.** A blanket external-user-id fan-out would reach an opted-out device on a multi-device user; targeting reconciled consented player ids is the correct primitive.
- **Config over branching.** Metadata-driven decisions keep the suppression logic a pure, property-testable function and make adding a type a config change, not a code branch.
- **Clean ownership boundary.** The only shared code is the domain-agnostic `OutboxWriter` in `packages/shared`; per-domain `event_id`/payload shaping lives in each emitting domain, and domain→intent mapping lives only in the notifications mappers — so `packages/shared` never learns domain semantics.

## Alternatives Considered
- **`EventEmitter2`/Centrifugo as the trigger.** Rejected: an in-process listener or a dropped realtime frame can miss a committed fact; only a durable outbox row committed with the fact is recoverable.
- **Blanket external-user-id fan-out.** Rejected: cannot honor per-device consent (Model A would reach opted-out devices).
- **A `notification_deliveries` table (per-device delivery state) in the MVP.** Deferred as a documented future enhancement; the per-intent ledger is sufficient for the at-least-once contract.
- **Claiming exactly-once end-to-end delivery.** Rejected as untruthful given OS/transport retries.
- **Keeping push inside the `offers` module.** Rejected: it couples one domain, lacks a device registry/ledger/preferences, and can't consume other domains' facts.

## Consequences
- The notifications module reacts only to committed outbox rows; no business transaction depends on a push succeeding, and a notification failure is swallowed/retried.
- Everything is testable in CI (backend) and locally (mobile) with OneSignal/BullMQ/Postgres mocked — the pure decision/dedup/targeting logic is covered by property-based tests (P3/P6/P8/P9/P10/P12/P14/P16/P17/P18); the mobile OneSignal SDK is behind an injectable seam.
- Runtime secrets (`ONESIGNAL_API_KEY`, `ONESIGNAL_WEBHOOK_SECRET`) live only in server config; `EXPO_PUBLIC_ONESIGNAL_APP_ID` is the only OneSignal value the client sees; `validateNotificationsConfig()` fails fast on a missing required value; secrets/PII are never logged and deep-links carry ids only.
- **Deferred coupling (Task 12):** the emitting domains (`offers`, `payments`, `negotiation`, `chat`, `voip-calls`) must still write their `<domain>_outbox` row in the same transaction as the business fact (and `offers` must drop its direct `OneSignalClient.send`). This cross-cutting change is coordinated after the parallel voice-notes (chat) and voip work lands; until then the relay drains empty outbox tables (a safe no-op) and the legacy offer push path is left intact.
