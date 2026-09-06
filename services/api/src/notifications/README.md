# Notifications Module (Spec 16)

## Purpose

The dedicated, first-class notification system. It gives BidClean a single path to reliably reach a Host or Cleaner when the app is backgrounded/closed (via OneSignal push) and coordinates with in-app realtime alerts when it is open. It **reacts** to committed business facts through a **durable transactional outbox**; it is never a source of business truth, and no business transaction depends on a push succeeding. It consolidates the previously offer-scoped push into one module and holds the generalized `OneSignalClient`.

Delivery **intent** is exactly-once in PostgreSQL (single-winner `PENDING → PROCESSING`, `UNIQUE dedup_key`); external OneSignal delivery is **at-least-once/best-effort** (mitigated by a provider idempotency key). Targeting is **per consented player id (Model B)** — never a blanket external-user-id fan-out.

## Files

| File | Responsibility |
|------|---------------|
| `notifications.constants.ts` | Env-driven config + `validateNotificationsConfig()` fail-fast + per-type metadata source |
| `notifications.types.ts` | Local mirror of the shared notification contract (types/enums) |
| `notification-type.registry.ts` | `NotificationType → { priority, category, quietHoursBehavior, defaultEnabled }` |
| `notification-content.catalog.ts` | Per-type `en`/`es` templates + startup parity check + `render()` |
| `preference.service.ts` | Pure `decide()` — the metadata-driven suppression decision (calls exempt, fail-open) |
| `device-registry.service.ts` | Model B registry authority (register/consent/unregister, stale, tags, OneSignal sync) |
| `notification.service.ts` | `createIntent()` — durable-first, atomic suppression, exactly-once intent |
| `notifications.repository.ts` | Parameterized SQL: devices, preferences, ledger single-winner, relay scan, webhook dedup |
| `outbox-relay.processor.ts` | Repeatable drain of the five `<domain>_outbox` tables → intents |
| `delivery.worker.ts` | BullMQ worker: single-winner → per-device send → SENT/FAILED_*/SUPPRESSED |
| `reconcile-sweep.processor.ts` | Bounded periodic registry ↔ OneSignal drift repair |
| `onesignal/onesignal.client.ts` | Generalized best-effort OneSignal transport (server-only REST key) |
| `webhooks/onesignal-webhook.controller.ts` | Signed, idempotent OneSignal webhook ingress |
| `webhooks/onesignal-signature.ts` | Pure HMAC-SHA256 verification over the raw body |
| `mappers/*.ts` | Per-domain outbox-row → `NotificationIntent` mappers (id-based deep-links) |
| `notification-device.controller.ts` | `POST/PATCH/DELETE /notifications/devices` (JWT-subject scoped) |
| `notification-preference.controller.ts` | `GET/PUT /notifications/preferences` (self-scoped) |
| `entities/*.ts` | TypeORM entities for the ledger, devices, preferences, webhook events, and outbox read-models |
| `notifications.module.ts` | Wiring; validates config in `onModuleInit` |

## Dependencies

- **Reads** the five `<domain>_outbox` tables (owned/written by the emitting domains — see migration `1700000030000`).
- `auth` (`User` entity + `JwtAuthGuard`) for identity resolution and OneSignal tag computation.
- BullMQ/Redis (delivery queue), `@nestjs/schedule` (relay + reconcile sweeps), OneSignal (transport).

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/notifications/devices` | Register/upsert the caller's device (Model B) |
| PATCH | `/notifications/devices/:playerId/consent` | Update a device's consent |
| DELETE | `/notifications/devices/:playerId` | Unregister (logout) a device |
| GET | `/notifications/preferences` | Read the caller's preferences |
| PUT | `/notifications/preferences` | Update categories + quiet-hours |
| POST | `/webhooks/onesignal` | Signed, idempotent OneSignal delivery/subscription callbacks (public) |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ONESIGNAL_APP_ID` | OneSignal app id | Yes |
| `ONESIGNAL_API_KEY` | OneSignal REST key (server-only) | Yes |
| `ONESIGNAL_API_URL` | REST base URL | No (default) |
| `ONESIGNAL_TIMEOUT_MS` | HTTP timeout | No (default) |
| `ONESIGNAL_WEBHOOK_SECRET` | HMAC secret for webhook auth | Yes |
| `ONESIGNAL_WEBHOOK_TOLERANCE_SECONDS` | Webhook replay window | No (default) |
| `NOTIFICATIONS_DELIVERY_MAX_ATTEMPTS` / `_BACKOFF_MS` | Delivery retry/backoff | No (default) |
| `NOTIFICATIONS_RELAY_INTERVAL_MS` / `_BATCH_SIZE` | Outbox relay cadence/batch | No (default) |
| `NOTIFICATIONS_RECONCILE_INTERVAL_MS` / `_BATCH_SIZE` | Reconcile sweep cadence/batch | No (default) |
| `NOTIFICATIONS_RETENTION_DAYS` | Terminal-row prune horizon | No (default) |

## Correctness Properties

Property-based (fast-check, ≥100 iters): **P3** (exactly-once intent), **P6** (Model B targeting), **P8/P9/P10** (metadata-driven decision, defaults, fail-open), **P12** (single-winner), **P14** (deep-link ids only), **P16** (webhook auth/idempotency), **P17** (registry convergence), **P18** (deletion coherence). Unit tests cover the registry, catalog, config, service, worker, controllers, and relay.

## Emitting-domain outbox writes (Task 12 — done)

Each emitting domain now writes its `<domain>_outbox` row **in the same DB transaction** as the business fact, so the relay above has real rows to drain. The domain-owned `event_id` derivation + ids-only payload shaping live in a small helper per domain (`<domain>-outbox.ts`); the shared/api-local `writeOutbox(tx, row)` stays domain-agnostic.

| Domain | Fact → outbox write | Transactional executor | `event_id` scheme |
|--------|--------------------|------------------------|-------------------|
| offers | new-offer fallback → `offer_outbox` `offer.matched` (replaces the direct `OneSignalClient.send`, REQ-NP13) | `dataSource.transaction` in `OfferNotificationService` | `offer:<offerId>:<type>:<recipientUserId>` |
| payments | captured/failed/released/refunded/disputed → `payment_outbox` | `manager` in `PaymentsRepository` money-state txns | `payment:<paymentId>:<type>:<recipientUserId>` |
| negotiation | proposal created/countered/rejected/accepted → `negotiation_outbox` | `manager` in `insertProposalLocked` / wrapped `setProposalStatus` / `markProposalAccepted` | `proposal:<proposalId>:<type>:<recipientUserId>` |
| chat | TEXT + VOICE message persisted → `chat_outbox` `message-created` | `manager` in `ChatRepository.insertMessage` / `insertVoiceMessage` | `message:<messageId>:message-created` |
| voip | call reaches RINGING (fresh insert) → `voip_outbox` `call-invited` | `manager` in `VoipService.initiate` | `call:<callId>:call-invited` |

Atomicity: if the business-fact transaction rolls back, the outbox row rolls back too (single `INSERT` on the same executor). Exactly-once intent is preserved by the deterministic `event_id` → ledger `dedup_key`. `EventEmitter2`/Centrifugo fast-paths are unchanged and stay best-effort. Property tests: `common/outbox/__tests__/emitting-domain-outbox.property.spec.ts`.

## Pending / Blocked

- **Integration tests (Spec tasks 18.x)** require Postgres + Redis and are blocked in the CI-less local environment; the pure logic they would exercise is covered by the property/unit tests above.
