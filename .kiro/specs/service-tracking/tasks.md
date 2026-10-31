# Implementation Plan: Service Tracking

## Overview

`service-tracking` (Spec 17, first of Sprint 5 — Service Execution) covers the phase **after a match is locked and escrow is charged, but before the work begins**: the Cleaner heads to the property, the Host watches the live position approach on a map, and a **server-authoritative geofence** confirms arrival and unlocks on-arrival video verification (Spec 18). It is **not a new domain** — a `service_sessions` row is a durable execution lifecycle bound 1:1 to one matched offer, inheriting that offer's two participants (`hostId`/`cleanerId`) and their server-side authorization exactly the way chat/voip inherit authorization from a conversation.

Implementation is bottom-up: config/constants + migration (`service_sessions`, `service_outbox`, `service_outbox_consumers`, `service_activation_consumed`) → entities/types → geofence + rate-limiter + participation collaborators → repository (single-winner conditional writes + per-consumer outbox queries) → session service (state machine + position ingress Option A) → activation consumer + offer-terminal listener → sweep processor → controller + module wiring → auth `service:session:{id}` token → mobile surface (types/constants/api, `usePositionReporter`, `useTrackingChannel`, `tracking.store`, `EnRouteScreen`/`TrackingScreen` + navigation + i18n) → property-based and integration tests. Everything is testable in CI (backend) and locally (mobile) with Centrifugo, BullMQ, PostgreSQL+PostGIS mocked — zero real external calls.

**Authority split:** the matched offer owns who may participate; PostgreSQL is the source of truth for the session lifecycle + arrival fact; Centrifugo is best-effort transport (never a correctness guarantee); the server owns the geofence *computation* (reported coordinates are client telemetry, not proof of physical presence — anti-spoofing is out of scope). Live position is **ephemeral** (evaluated then relayed, never persisted); the sole durable location datum is `arrival_distance_m`.

Scope: one geofence (property arrival only), no persistent breadcrumb/route history, no durable ETA, the tracking role ends at `IN_PROGRESS` (handed to Specs 18/19/20), no SOS/panic, no in-app turn-by-turn navigation, no push delivery (Spec 16 reacts to durable `service_*` events). See `requirements.md` (7 requirements + REQ-ST1…REQ-ST12) and `design.md` (P1–P12).

## Tasks

- [ ] 1. Backend config, constants & schema
  - [ ] 1.1 Add service-tracking env to `.env.example`
    - Add `SERVICE_GEOFENCE_RADIUS_M`, `SERVICE_POSITION_MIN_INTERVAL_MS` (server-side rate limit), `SERVICE_POSITION_MAX_ACCURACY_M`, `SERVICE_POSITION_MAX_AGE_MS`, `SERVICE_POSITION_MAX_CLOCK_SKEW_MS`, `SERVICE_POSITION_CHANNEL_PREFIX` (default `service:session:`), `SERVICE_POSITION_TOKEN_TTL_SECONDS`, `SERVICE_EN_ROUTE_STALE_MS`, `SERVICE_SESSION_ABANDON_MS`, `SERVICE_SWEEP_INTERVAL_MS`, `SERVICE_SWEEP_BATCH_SIZE`; document that `CENTRIFUGO_TOKEN_SECRET` / `CENTRIFUGO_API_URL` / `CENTRIFUGO_API_KEY` (already present) are reused; add mobile `EXPO_PUBLIC_SERVICE_POSITION_MIN_INTERVAL_MS` (client-side send cadence)
    - _Requirements: 6.1, 6.4_
  - [ ] 1.2 Create service-tracking constants with startup validation
    - Create `services/api/src/service-tracking/service-tracking.constants.ts`: parse all `SERVICE_*` values from `ConfigService` + reused `CENTRIFUGO_*`; `validateServiceTrackingConfig()` fail-fast (non-test) for required values (positive radius/intervals/TTLs, channel prefix non-empty, Centrifugo secret present) consistent with `validateChatConfig`; no hardcoded values in logic
    - _Requirements: 6.1, 6.2, 6.4 · P4_
  - [ ] 1.3 Create the service-tracking schema migration
    - Create `services/api/src/migrations/<timestamp>-CreateServiceSessions.ts` (reversible `up()`/`down()`, `IF NOT EXISTS`, table/column comments): (a) `service_sessions` — UUID PK, `offer_id` FK → `offers(id)` **ON DELETE CASCADE** + **`UNIQUE`**, `host_id`/`cleaner_id` FK → `users(id)` **ON DELETE SET NULL**, `property_id` FK → `properties(id)` **ON DELETE SET NULL**, `property_location_snapshot GEOGRAPHY(Point,4326) NOT NULL`, `geofence_radius_m INTEGER NOT NULL`, `state VARCHAR(20) NOT NULL DEFAULT 'MATCHED'` + CHECK, `ended_reason VARCHAR(30)` + CHECK, `en_route_at`/`arrived_at`/`started_at`/`last_progress_at TIMESTAMPTZ` nullable, `arrival_distance_m INTEGER` nullable, `created_at`/`updated_at TIMESTAMPTZ DEFAULT NOW()`, **no `deleted_at`, no breadcrumb column**; indexes `uq_service_sessions_offer`, `idx_service_sessions_host/cleaner/property`, partial `idx_service_sessions_sweep (state, last_progress_at) WHERE state IN ('MATCHED','EN_ROUTE')`; (b) `service_outbox` (`event_id UNIQUE`, `aggregate_type`/`aggregate_id`, `type`, `payload JSONB`, `version`, `created_at`; **no `relayed_at`**; `idx_service_outbox_created`); (c) `service_outbox_consumers` (`event_id` FK → `service_outbox(event_id)` **ON DELETE CASCADE**, `consumer_name VARCHAR(50)`, `processed_at`; `uq_service_outbox_consumers_event_consumer (event_id, consumer_name)`, `idx_service_outbox_consumers_consumer`); (d) `service_activation_consumed` (`upstream_event_id VARCHAR(255) UNIQUE`, `consumed_at`); `down()` drops in dependency order (`service_outbox_consumers` before `service_outbox`)
    - _Requirements: 7.1, 7.2, 7.3 · P1, P11_

- [ ] 2. Entities & domain types
  - [ ] 2.1 Create service-tracking entities
    - Create `services/api/src/service-tracking/entities/service-session.entity.ts`, `service-outbox.entity.ts`, `service-outbox-consumer.entity.ts`, `service-activation-consumed.entity.ts` mirroring sibling entity conventions (timestamptz, snake_case, `@Unique`/`@Index` matching the migration, CHECK-aligned `state`/`ended_reason` unions, `geography` column mapping for `property_location_snapshot`)
    - _Requirements: 7.1_
  - [ ] 2.2 Create service-tracking domain types + error messages
    - Create `services/api/src/service-tracking/service-tracking.types.ts` (`ServiceSessionView`, `PositionSample` `{ lat, lng, accuracy, heading?, at }`, `SessionState`, `EndedReason`, `EligibilityResult`, `GeofenceResult` `{ within, distanceM }`, `ActivationPayload` `{ offerId, hostId, cleanerId, propertyId }`, outbox event payload shapes) and typed error strings (no coordinates/PII embedded)
    - _Requirements: 1.1, 3.1, 4.4_

- [ ] 3. Geofence, rate-limiter & participation collaborators
  - [ ] 3.1 Implement GeofenceService (pure eligibility + PostGIS arrival)
    - Create `services/api/src/service-tracking/geofence.service.ts`: `isEligible(sample, serverNow, config): boolean` — eligible iff `accuracy ≤ MAX_ACCURACY_M` AND `(serverNow − at) ≤ MAX_AGE_MS` AND `at ≤ serverNow + MAX_CLOCK_SKEW_MS` (rejects future-dated), pure/unit-testable; `isWithinGeofence(snapshotPoint, sample, radiusM): Promise<{ within, distanceM }>` via repository `ST_DWithin` + `ST_Distance` over the session's **snapshot**; `accuracy` is an **eligibility gate ONLY** (never widens/narrows/corrects the radius), `distanceM` is the geometric geodesic distance
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.7 · P5_
  - [ ] 3.2 Implement PositionRateLimiter (Redis, per user+session)
    - Create `services/api/src/service-tracking/position-rate-limiter.ts`: `shouldAccept(userId, sessionId, now): Promise<boolean>` backed by Redis, rejecting (dropping/coalescing) samples faster than `SERVICE_POSITION_MIN_INTERVAL_MS` per `(user, session)`; over-frequent samples ignored, never errored; never trusts the client to self-limit
    - _Requirements: 2.3, 6.1 · P8_
  - [ ] 3.3 Implement ServiceSessionParticipationService
    - Create `services/api/src/service-tracking/service-session-participation.service.ts`: `isParticipant(userId, sessionId): Promise<boolean>` — thin lookup resolving `host_id`/`cleaner_id`; single source of the participation rule used by both service-tracking authorization and the auth subscription-token endpoint
    - _Requirements: 1.3, 2.4, 2.5 · P3_
  - [ ]* 3.4 Unit tests for collaborators
    - `isEligible` boundary matrix (accuracy/age/skew at, below, above limits; future-dated rejected); `isWithinGeofence` distance/radius edges over the snapshot; rate-limiter accept/drop across cadences + per-(user,session) isolation; participation host/cleaner resolution + non-participant denial
    - _Requirements: 2.3, 3.2, 1.3 · P3, P5, P8_

- [ ] 4. Repository (single-winner writes + per-consumer outbox)
  - [ ] 4.1 Implement ServiceSessionRepository
    - Create `services/api/src/service-tracking/service-session.repository.ts` (parameterized SQL only): `createSession(payload)` idempotent `INSERT ... ON CONFLICT (offer_id) DO NOTHING` (snapshots point + radius); single-winner `transition(id, expected, next, derivedFields, outboxEvent)` — `UPDATE ... WHERE id=:id AND state=:expected` + derived timestamps + `service_outbox` row in ONE transaction; `findById`, `findByOfferId`; sweep queries `findAbandonedMatched(before, limit)` / `findExpirableEnRoute(before, limit)`; geofence `ST_DWithin`/`ST_Distance` over `property_location_snapshot`; per-consumer outbox `findOutboxUnackedFor(consumerName, batch)` (`NOT EXISTS` against `service_outbox_consumers`) + `ackOutboxFor(eventId, consumerName)` (`ON CONFLICT (event_id, consumer_name) DO NOTHING`); activation cursor `findActivationUnconsumed(batch)` + `markActivationConsumed(upstreamEventId)`
    - _Requirements: 1.1, 1.5, 3.3, 4.3, 7.4 · P1, P6, P12_
  - [ ]* 4.2 Unit tests for repository
    - idempotent `ON CONFLICT` create (redelivery = no-op); single-winner conditional write (rows=1 winner writes derived fields + outbox atomically vs rows=0 no-op); `transition` writes the `service_outbox` row in the same transaction; sweep queries select only aged non-terminal rows; `findOutboxUnackedFor` selects only rows lacking an ack for the given `consumer_name`; `ackOutboxFor` idempotent; two consumer names drain the same event independently
    - _Requirements: 1.5, 3.3, 4.3, 7.4 · P1, P6, P12_

- [ ] 5. Session service (state machine + position ingress, Option A)
  - [ ] 5.1 Implement ServiceSessionService state machine
    - Create `services/api/src/service-tracking/service-session.service.ts` (functions ≤30 lines, SRP): `createFromActivation(payload)` idempotent creation (snapshot point + radius, `ON CONFLICT` no-op; per-row try/catch so a failure never blocks the batch or the source tx); `startEnRoute(sessionId, userId)` assert caller is Cleaner → single-winner `MATCHED → EN_ROUTE` + `en_route_at` + `service_en_route`; `start(sessionId, userId)` assert Cleaner → `ARRIVED → IN_PROGRESS` + `started_at` + `service_started`; `cancelByParticipant(sessionId, userId)` → non-terminal → `CANCELED` (`CANCELED_BY_PARTICIPANT`); `forceCancelForOffer(offerId, reason)` idempotent → `CANCELED` (`CANCELED_OFFER_TERMINAL`); `getSession(sessionId, userId)` participant-gated reconciliation read; illegal transitions rejected (`409`), terminal-for-tracking immutable
    - _Requirements: 1.1, 4.1, 4.2, 4.3, 4.4, 4.6, 4.8 · P1, P6_
  - [ ] 5.2 Implement position ingress + geofence arrival
    - Add `ingestPosition(sessionId, userId, sample)`: assert caller is the Cleaner + session `EN_ROUTE`; delegate eligibility + geofence to `GeofenceService`; update `last_progress_at` on each eligible sample; on an eligible in-radius sample, single-winner `EN_ROUTE → ARRIVED` setting `arrived_at` (**server** timestamp, not client `at`), `arrival_distance_m` (geometric geodesic distance), and `service_arrived` outbox event in the SAME transaction; **always** best-effort re-publish the position to `service:session:{id}` via the reused `CentrifugoClient` (publish failure swallowed); coordinates never persisted, never logged verbatim
    - _Requirements: 2.1, 2.2, 2.6, 3.1, 3.3, 3.4, 3.6, 7.5 · P5, P9, P10_
  - [ ]* 5.3 Unit tests for ServiceSessionService
    - participant + state gates on every action (non-participant/non-Cleaner rejected); single-winner transition (winner vs no-op); atomic persist + outbox; `arrived_at` uses the server timestamp; ineligible/out-of-radius sample stays `EN_ROUTE` with no arrival fact (never errors); client "arrived" claim never sets the fact; best-effort publish failure non-blocking; idempotent `forceCancelForOffer`
    - _Requirements: 3.3, 3.4, 4.2, 4.6, 2.6 · P5, P6, P10_

- [ ] 6. Activation consumer, offer-terminal listener & outbox fan-out
  - [ ] 6.1 Implement ServiceActivationConsumer (own checkpoint)
    - Create `services/api/src/service-tracking/service-activation.consumer.ts`: drains the upstream `service_activation_ready` outbox for rows service-tracking has not yet acked (`NOT EXISTS` against `service_activation_consumed`, ordered by `created_at`, bounded batch), calls `createFromActivation()`, then inserts its own ack in `service_activation_consumed` (`ON CONFLICT (upstream_event_id) DO NOTHING`); **never** mutates a shared `relayed_at` on the offer/escrow-owned table; row-scoped catch so a failure isolates from the source match/escrow flow and leaves the row re-drainable
    - _Requirements: 1.1, 1.2, 1.5 · P1, P2_
  - [ ] 6.2 Implement ServiceOutboxConsumerCheckpoint (fan-out primitive)
    - Create `services/api/src/service-tracking/service-outbox-consumer.checkpoint.ts`: `drainUnacked(consumerName, batch)` selects `service_outbox` rows with no `service_outbox_consumers` row for `consumerName`; `ack(eventId, consumerName)` inserts the ack (`ON CONFLICT (event_id, consumer_name) DO NOTHING`); this is the seam that lets the Spec 16 notifications consumer and the Spec 18 video consumer each receive `service_arrived` independently with no shared marker
    - _Requirements: 3.6, 7.4 · P12_
  - [ ] 6.3 Implement OfferTerminalSessionListener
    - Create `services/api/src/service-tracking/offer-terminal-session.listener.ts` (mirrors voip's `OfferTerminalCallListener`): on offer terminal (cancelled/expired/completed) or match invalidation, call `forceCancelForOffer(offerId, CANCELED_OFFER_TERMINAL)` idempotently; wire via the existing offer-terminal path (event listener or direct call), introducing no new coupling
    - _Requirements: 4.6 · P7_
  - [ ]* 6.4 Unit tests for consumers & listener
    - activation consumer creates off its own checkpoint (no shared `relayed_at` mutation), idempotent on redelivery, failure isolated + re-drainable; outbox checkpoint `drainUnacked` selects only unacked-for-consumer rows, `ack` idempotent, two consumer names independent (one acking never starves the other); offer-terminal listener idempotent force-cancel
    - _Requirements: 1.2, 1.5, 3.6, 4.6 · P1, P2, P7, P12_

- [ ] 7. Sweep processor (no stuck session)
  - [ ] 7.1 Implement ServiceSweepProcessor
    - Create `services/api/src/service-tracking/service-sweep.processor.ts` (BullMQ repeatable, interval/batch from `SERVICE_SWEEP_INTERVAL_MS`/`SERVICE_SWEEP_BATCH_SIZE`): abandon sweep `MATCHED` older than `SERVICE_SESSION_ABANDON_MS` → `EXPIRED` (`EXPIRED_NEVER_STARTED`); stale sweep `EN_ROUTE` with no eligible progress within `SERVICE_EN_ROUTE_STALE_MS` (via `last_progress_at`) → `EXPIRED` (`EXPIRED_NO_PROGRESS`); property-removed sweep — non-terminal session whose `property_location_snapshot` is unusable → `EXPIRED` (`EXPIRED_PROPERTY_REMOVED`) (a mere property deletion does NOT trigger this, only an unusable snapshot); each expiry a bounded, idempotent, single-winner write with best-effort state signal publish
    - _Requirements: 4.5, 4.7 · P7_
  - [ ]* 7.2 Unit tests for the sweep
    - correct differentiated `ended_reason` per branch; bounded + idempotent + single-winner (re-run over already-terminal rows is a no-op); property deletion with a usable snapshot is NOT swept; only an unusable snapshot yields `EXPIRED_PROPERTY_REMOVED`
    - _Requirements: 4.5, 4.7 · P7_

- [ ] 8. Controller, auth token & module wiring
  - [ ] 8.1 Implement ServiceSessionController + DTOs
    - Create `services/api/src/service-tracking/service-session.controller.ts` (`@Controller('service-sessions') @UseGuards(JwtAuthGuard)`, `ValidationPipe({ whitelist, forbidNonWhitelisted })`, identity from `req.user.keycloakId → userId`): `GET /service-sessions/:id` (participant-gated reconciliation); `POST /:id/en-route`; `POST /:id/position` (`PositionSampleDto` `{ lat, lng, accuracy, heading?, at }` — rate-limited in the controller BEFORE the service, then eligibility-gated/geofence-evaluated/re-published); `POST /:id/start`; `POST /:id/cancel`; a non-participant receives `403` and learns nothing about the session's existence
    - _Requirements: 1.3, 2.1, 2.3, 2.5, 4.1, 4.2, 4.8 · P3, P8_
  - [ ] 8.2 Extend auth Centrifugo token for the session channel
    - Extend the existing `CentrifugoTokenController` (from realtime-chat): for `?channel=service:session:{id}`, mint a subscription token only after `ServiceSessionParticipationService.isParticipant(sub, id)` is true, else `403`; the token scopes the **Host to subscribe read-only** on that one channel with **no publish grant** (the server is the sole publisher); HMAC-signed with `CENTRIFUGO_TOKEN_SECRET`, TTL from `SERVICE_POSITION_TOKEN_TTL_SECONDS`; the secret never reaches the client except as the time-boxed token
    - _Requirements: 2.4, 6.2 · P4_
  - [ ] 8.3 Create ServiceTrackingModule & wire providers
    - Create `services/api/src/service-tracking/service-tracking.module.ts` registering the controller, `ServiceSessionService`, `GeofenceService`, `PositionRateLimiter`, `ServiceSessionParticipationService`, `ServiceSessionRepository`, `ServiceActivationConsumer`, `ServiceOutboxConsumerCheckpoint`, `OfferTerminalSessionListener`, `ServiceSweepProcessor` and their BullMQ queues (reuse the existing Redis/BullMQ + `CentrifugoClient`); register the new entities; call `validateServiceTrackingConfig()` on boot; import into the app module; export `ServiceSessionParticipationService` for the auth module
    - _Requirements: 6.1_
  - [ ]* 8.4 Endpoint & auth-token integration tests
    - each endpoint participant-gated (non-participant → `403`, no disclosure); position endpoint rate-limits before evaluating; subscription token minted iff participant, read-only Host scope, no publish grant, secret never shipped; illegal transition → `409`
    - _Requirements: 1.3, 2.3, 2.4, 4.4 · P3, P4, P8_

- [ ] 9. Checkpoint — backend compiles, tests green, CI-equivalent
  - Ensure `services/api` typechecks, ESLint (`--max-warnings 0`) clean on touched files, and the full API suite passes; ask the user if questions arise.

- [ ] 10. Mobile core (types, constants, api, store)
  - [ ] 10.1 Create mobile tracking types & constants
    - Create `apps/mobile/src/screens/tracking/tracking.types.ts` (`ServiceSession`, `LivePosition`, `SessionState`, `ConnectionStatus`) and `tracking.constants.ts` (routes/endpoints, channel prefix, client send cadence `EXPO_PUBLIC_SERVICE_POSITION_MIN_INTERVAL_MS`, map defaults, i18n keys — all from `EXPO_PUBLIC_*`/constants, none hardcoded)
    - _Requirements: 5.5, 6.4_
  - [ ] 10.2 Implement tracking.api.ts
    - Create `apps/mobile/src/screens/tracking/tracking.api.ts` over the shared `apiClient`: `getSession`, `startEnRoute`, `postPosition`, `start`, `cancel`, and `getSessionChannelToken` (subscription token fetch)
    - _Requirements: 5.1, 5.2_
  - [ ] 10.3 Implement usePositionReporter (Cleaner)
    - Create `apps/mobile/src/screens/tracking/usePositionReporter.ts`: request location permission, throttle sends to `EXPO_PUBLIC_SERVICE_POSITION_MIN_INTERVAL_MS`, POST samples only while `EN_ROUTE`; degrade gracefully when permission is denied/unavailable (i18n explanation, never crash) — the session still functions via server-side geofence on whatever coordinates are provided; **never** publishes directly to the channel
    - _Requirements: 5.1, 5.3 · P8_
  - [ ] 10.4 Implement useTrackingChannel (Host) + tracking.store
    - Create `apps/mobile/src/screens/tracking/useTrackingChannel.ts` mirroring `useCentrifugoChannel`'s resilient skeleton (token fetch, WS connect to `service:session:{id}`, envelope unwrap, bounded exponential-backoff reconnect, foreground reconcile via `GET`, teardown) parsing live position + state signals — read-only subscriber, no publish path; create `tracking.store.ts` (Zustand `TrackingState` = session + latest live position + connectionStatus; actions `loadSession`, `startEnRoute`, `reportPosition`, `markStarted`, `cancel`, `onLivePosition`, `onStateSignal`, `reconcile`, `reset`) where state-signal application is idempotent and ignores regressions (older/illegal transitions no-op), authoritative state always recoverable via `GET`
    - _Requirements: 5.2, 5.4, 2.6, 4.8 · P10_
  - [ ]* 10.5 Unit tests for mobile core
    - `usePositionReporter` client throttle + permission-denied graceful degrade (no crash) + posts only while `EN_ROUTE`; `useTrackingChannel` token fetch, bounded backoff reconnect, foreground reconcile, teardown, read-only (no publish); `tracking.store` idempotent state-signal application (ignore regressions/older/illegal), `reconcile` via `GET`, reset
    - _Requirements: 5.1, 5.2, 5.3, 5.4 · P10_

- [ ] 11. Mobile screens, navigation & i18n
  - [ ] 11.1 Implement EnRouteScreen (Cleaner) & TrackingScreen (Host)
    - Create `apps/mobile/src/screens/tracking/EnRouteScreen.tsx` (destination + optional live ETA shown-not-durable, position reporting via `usePositionReporter`, a "Start" affordance enabled only when `ARRIVED`) and `TrackingScreen.tsx` (Mapbox rendering the Cleaner's live position + current state "on the way / arrived / started", a clear "Cleaner has arrived" indication on `ARRIVED`, a "location unavailable" state rather than a stale position); Mapbox is **render only**, never the source of truth for position or arrival; dark BidClean tokens
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6_
  - [ ] 11.2 Wire tracking navigation for both roles
    - Reach `TrackingScreen` from the Host active-job entry point and `EnRouteScreen` from the Cleaner active-job entry point in the respective navigators, keyed by the session's `offerId`/`id`
    - _Requirements: 5.1, 5.2_
  - [ ] 11.3 Add tracking i18n (en + es)
    - Create `apps/mobile/src/i18n/locales/en/tracking.json` and `es/tracking.json` (parity): on-the-way/arrived/started states, "Cleaner has arrived", location-permission/unavailable explanations, Start affordance, ETA label
    - _Requirements: 5.5_
  - [ ]* 11.4 Unit tests for screens
    - "Start" enabled only when `ARRIVED`; Host renders live position + state + "arrived" + "location unavailable"; Mapbox mocked (render only); dark tokens; `en`/`es` i18n parity
    - _Requirements: 5.3, 5.4, 5.5, 5.6_

- [ ] 12. Checkpoint — full tracking UX integrated on mobile
  - Ensure api + reporter + channel + store + screens + navigation + i18n work together against mocks; mobile `tsc --noEmit` + ESLint + Jest clean; ask the user if questions arise.

- [ ] 13. Property-Based Tests (fast-check)
  - [ ]* 13.1 Property: Idempotent creation from one durable fact
    - **Property 1** — **Validates: Requirements 1.1, 1.5 · REQ-ST1** — random activation payloads × N redeliveries × concurrent interleavings → exactly one `service_sessions` row per `offer_id`, `MATCHED`, snapshot copied; every redelivery/concurrent attempt a no-op
  - [ ]* 13.2 Property: Additive & non-blocking isolation
    - **Property 2** — **Validates: Requirements 1.2 · REQ-ST1** — random failures injected into the activation listener/create path → source match/escrow fact commits unchanged and the activation outbox row stays re-drainable; no tracking-side failure propagates
  - [ ]* 13.3 Property: Participant isolation
    - **Property 3** — **Validates: Requirements 1.3, 2.5 · REQ-ST2** — random `(user, session)` pairs across all endpoints → access iff user ∈ {host_id, cleaner_id}, else `403` with no disclosure and no position data; a session id / channel name never authorizes
  - [ ]* 13.4 Property: Token scoping (auth-owned, read-only Host)
    - **Property 4** — **Validates: Requirements 2.4, 6.2 · REQ-ST2, REQ-ST8** — random participant/non-participant pairs + channels → subscription token iff participant (resolved by lookup, never the channel string), read-only Host scope, no publish grant, secret never shipped
  - [ ]* 13.5 Property: Server-authoritative geofence over the snapshot (eligibility-gated)
    - **Property 5** — **Validates: Requirements 3.1, 3.2, 3.4, 3.5, 3.7, 4.7 · REQ-ST4, REQ-ST12** — random points, accuracy, sample age, future-dated `at` beyond/within clock-skew, radii, post-creation config/property mutations → `ARRIVED` iff eligible (accuracy ≤ max AND age ≤ max AND `at ≤ server_now + skew`) AND geodesic distance ≤ snapshot radius; snapshot values used; `accuracy` only gates (never corrects the radius); `arrival_distance_m` geometric geodesic; a future-dated/ineligible sample or a bare client claim never arrives (never errors)
  - [ ]* 13.6 Property: Single-winner, atomic, monotonic state machine
    - **Property 6** — **Validates: Requirements 3.3, 4.1, 4.2, 4.3, 4.4, 7.4 · REQ-ST5, REQ-ST6** — random `(from,to)` pairs + N concurrent actors → exactly one conditional write wins and sets derived fields + outbox atomically; illegal edges rejected; terminal-for-tracking immutable; no `ARRIVED` without `arrived_at`, no `service_arrived` without a committed arrival
  - [ ]* 13.7 Property: No stuck session, differentiated causes
    - **Property 7** — **Validates: Requirements 4.5, 4.6, 4.7 · REQ-ST7** — random session ages/progress/thresholds + terminal signals → correct differentiated `ended_reason` (`EXPIRED_NO_PROGRESS`/`EXPIRED_NEVER_STARTED`/`EXPIRED_PROPERTY_REMOVED`/`CANCELED_OFFER_TERMINAL`/`CANCELED_BY_PARTICIPANT`); bounded, idempotent, single-winner
  - [ ]* 13.8 Property: Server-side rate limiting
    - **Property 8** — **Validates: Requirements 2.3, 6.1 · REQ-ST11** — random sample arrival-time sequences per `(user, session)` → accepted samples spaced ≥ `SERVICE_POSITION_MIN_INTERVAL_MS`; excess ignored, never errored; client never trusted to self-limit
  - [ ]* 13.9 Property: Position is ephemeral (no persisted trail)
    - **Property 9** — **Validates: Requirements 2.2, 6.3, 7.5 · REQ-ST3** — random sequences of position samples → the only persisted location-derived datum is the single scalar `arrival_distance_m`; no coordinate/breadcrumb row exists; no raw coordinate or participant PII written to logs
  - [ ]* 13.10 Property: Best-effort transport, authoritative reconciliation
    - **Property 10** — **Validates: Requirements 2.6, 4.8 · REQ-ST3, REQ-ST7** — random re-publish outcomes / dropped frames → durable session state + arrival fact identical; `GET` returns authoritative PostgreSQL state independent of realtime
  - [ ]* 13.11 Property: Deletion coherence (no cascade-from-users)
    - **Property 11** — **Validates: Requirements 7.3 · REQ-ST9** — random session graphs + participant deletion → `host_id`/`cleaner_id`/`property_id` nulled while the session + `arrival_distance_m` are retained; only `offer_id` cascades; no user-cascade path destroys history
  - [ ]* 13.12 Property: Independent fan-out delivery to every outbox consumer
    - **Property 12** — **Validates: Requirements 3.6, 7.4 · REQ-ST5** — random `service_outbox` events (esp. `service_arrived`) × arbitrary consumer sets (notifications, video) × arbitrary drain/ack interleavings → every not-yet-acked consumer receives each event, per `(event_id, consumer_name)`; one consumer's ack never marks it processed for another; at-least-once + idempotent per consumer; no shared marker; the row was written in the same tx as its transition

- [ ] 14. Integration & Scenario Tests
  - [ ]* 14.1 Integration: activation → session creation
    - activation event → session created (`MATCHED`) via service-tracking's own consumer checkpoint; redelivery → still one session (`UNIQUE offer_id`); a create-path failure isolates from the source flow and leaves the row re-drainable
    - _Requirements: 1.1, 1.2, 1.5 · P1, P2_
  - [ ]* 14.2 Integration: full flow en-route → arrived → started
    - en-route (`MATCHED → EN_ROUTE` + `service_en_route`) → eligible position within radius → `ARRIVED` (server ts + `arrival_distance_m` + `service_arrived`) → start → `IN_PROGRESS` (`service_started`); ineligible/out-of-radius/future-dated samples stay `EN_ROUTE` with no arrival fact; rate-limited burst → only spaced samples evaluated; publish failure → state intact, `GET` reconciles
    - _Requirements: 2.1, 3.1, 3.2, 3.3, 4.1, 4.2, 2.6 · P5, P6, P8, P10_
  - [ ]* 14.3 Integration: outbox fan-out to independent consumers
    - one `service_outbox` event (e.g. `service_arrived`) → notifications consumer acks → video consumer still receives it; and vice versa (video acks first → notifications still receives it) — each acks only its own `(event_id, consumer_name)`, neither starves the other
    - _Requirements: 3.6, 7.4 · P12_
  - [ ]* 14.4 Integration: lifecycle edges, sweeps, deletion coherence
    - offer terminal → session force-`CANCELED` (`CANCELED_OFFER_TERMINAL`), further tracking rejected; abandon/stale sweeps → correct `EXPIRED_*`; property deletion mid-session → arrival still evaluates from the snapshot; user deletion → participant FKs SET NULL, session retained; non-participant denied on read/post/subscribe
    - _Requirements: 4.5, 4.6, 4.7, 7.3, 1.3 · P3, P7, P11_

- [ ] 15. Final Checkpoint — all tests pass, CI green, docs updated
  - Ensure the full API suite + mobile suite pass and CI-equivalent commands are green; update module READMEs (`services/api/src/service-tracking/README.md`, `apps/mobile/src/screens/tracking/README.md`, note the new `auth/centrifugo` `service:session:{id}` channel token in the auth module README), `docs/ARCHITECTURE.md` (add the service-tracking module + a service-tracking lifecycle flow diagram: activation → session → en-route → position ingress → geofence → arrived → started, the position-ingress Option A control-plane/media-plane split, and the `service_outbox` fan-out to independent per-consumer checkpoints), `docs/CHANGELOG.md` (`[Unreleased]`), and `docs/ADR/<nnn>-service-tracking-ephemeral-position-server-authoritative-geofence.md` (ephemeral live position + server-authoritative geofence over a creation-time snapshot, position ingress on the backend path Option A, fan-out outbox drained by independent per-consumer checkpoints — never a single shared `relayed_at`); mark the spec complete in `.kiro/specs/ROADMAP.md`; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests) and can be skipped for a faster MVP — but per this project's execution rules they are executed (unit, property-based, integration).
- Each task references specific requirements; property/integration tests cite the design's P1–P12 and the requirements' REQ-ST1…REQ-ST12.
- **A session IS a matched-offer lifecycle**, not a new domain: no new participant, authorization, or payment model. Authorization is resolved server-side from the offer's two parties.
- **Authority split:** PostgreSQL = source of truth for the session lifecycle + arrival fact; Centrifugo = best-effort transport (never a correctness guarantee); the server owns the geofence *computation* only. Live position is ephemeral; the sole durable location datum is `arrival_distance_m`.
- **Position ingress is Option A:** the Cleaner POSTs to the backend, the server runs the geofence and re-publishes to the Host over `service:session:{id}`; the Cleaner is never a channel publisher; the Host is a read-only subscriber.
- **GPS threat model:** reported coordinates are client telemetry, not cryptographic proof of physical presence; anti-spoofing is out of scope (human presence is complemented by Spec 18). `accuracy` is an eligibility gate only, never a radius correction.
- **Outbox fan-out:** `service_outbox` carries no shared `relayed_at`; per-consumer progress lives in `service_outbox_consumers` `(event_id, consumer_name)` so Spec 16 (notifications) and Spec 18 (video) each receive `service_arrived` independently; service-tracking consumes the upstream `service_activation_ready` via its own `service_activation_consumed` cursor.
- **No stuck session:** a bounded, idempotent, single-winner sweep force-expires stale/abandoned/unusable-snapshot sessions with a differentiated `ended_reason`; state is always recoverable via `GET`.
- **Deletion coherence (Spec 13 invariant):** `host_id`/`cleaner_id`/`property_id` are `ON DELETE SET NULL`; only `offer_id` cascades; no user-cascade path; no `deleted_at` (a terminal-for-tracking session is an immutable audit fact).
- **Out of scope:** persistent breadcrumb/route history, movement analytics, durable ETA, multi-point/departure/dwell geofencing, on-arrival video (Spec 18), checklist/photos (Spec 19), completion + escrow release (Spec 20), SOS/panic, in-app turn-by-turn navigation, push delivery (Spec 16), treating Mapbox as a source of truth.
- CI: backend jobs (API lint/typecheck, API tests) must stay green; mobile is verified locally.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["3.1", "3.2", "3.3", "3.4"] },
    { "id": 3, "tasks": ["4.1", "4.2"] },
    { "id": 4, "tasks": ["5.1", "5.2", "5.3"] },
    { "id": 5, "tasks": ["6.1", "6.2", "6.3", "6.4"] },
    { "id": 6, "tasks": ["7.1", "7.2"] },
    { "id": 7, "tasks": ["8.1", "8.2", "8.3", "8.4"] },
    { "id": 8, "tasks": ["10.1", "10.2", "10.3", "10.4", "10.5"] },
    { "id": 9, "tasks": ["11.1", "11.2", "11.3", "11.4"] },
    { "id": 10, "tasks": ["13.1", "13.2", "13.3", "13.4", "13.5", "13.6", "13.7", "13.8", "13.9", "13.10", "13.11", "13.12"] },
    { "id": 11, "tasks": ["14.1", "14.2", "14.3", "14.4"] }
  ]
}
```
