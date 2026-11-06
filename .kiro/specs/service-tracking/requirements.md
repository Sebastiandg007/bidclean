# Requirements Document

## Introduction

The `service-tracking` module covers the phase **after a match is made and escrow is charged, but before the service work begins**: the Cleaner heads to the property, the Host watches the Cleaner's live position approach on a map, and when the Cleaner physically reaches the property a **server-authoritative geofence** confirms arrival and unlocks the next step (on-arrival video verification, Spec 18). It is Spec 17, the first of Sprint 5 (Service Execution). It depends only on already-implemented specs: the matched offer / negotiation (Spec 8) and the escrow charge (Spec 9).

**A service session is a new lifecycle bound to the matched offer — not a new authorization or ownership model.** When an offer reaches `MATCHED` (a Cleaner accepted and, per Spec 9, the Host's card is charged into escrow), a `service_sessions` row is created for that offer, with participants exactly the offer's `hostId` and `cleanerId`. Its own execution state machine (`MATCHED → EN_ROUTE → ARRIVED → IN_PROGRESS`) advances the job toward the work itself. Authorization derives from the matched offer's two parties, resolved server-side — never from client-supplied identity, never from possession of a session id or channel name — exactly the pattern chat/voip use over a conversation.

**Position ingress path — the backend is on the path (Option A).** The Cleaner does **not** publish position directly to Centrifugo. Instead, position samples are sent to a **backend API endpoint** (`POST /service-sessions/:id/position`); the server runs the geofence check on each sample and **then re-publishes the position to the session's Centrifugo channel for the Host**. This makes the server unambiguously the geofence authority (it sees every sample it acts on) and keeps the Host's live view flowing:
```
Cleaner ──HTTP──► POST /service-sessions/:id/position ──► geofence (PostGIS) ──► DB transition (if arrived)
                                                     └──► publish position ──► Centrifugo ──► Host (subscribe)
```
The `service:session:{id}` channel is therefore an **output** transport (server → Host), never the geofence input. The Cleaner is not a publisher on the channel; only the server publishes.

**Two planes, kept strictly separate (mirroring the control-plane/media-plane split of voip-calls):**
- **Live position is ephemeral, never persisted history.** Position samples are evaluated server-side and re-published to the Host over the session channel, best-effort, and are **not** stored as a breadcrumb trail. PostgreSQL never holds a location history. This is a deliberate privacy + simplicity decision consistent with the plan (the backend evaluates + relays position; Mapbox only renders it; there is no persistent route log in v1).
- **PostgreSQL is the source of truth for the session lifecycle and the geofence crossing — the durable facts.** The `service_sessions` row (participants, `offerId`, state, `en_route_at`/`arrived_at`/`started_at`, the arrival geofence-crossing fact) is authoritative. State transitions are durable, single-winner conditional writes; live coordinates are not.

**Geofence is server-authoritative (computation), with an explicit GPS threat model.** Arrival is decided by the **backend** computing, with PostGIS, whether the Cleaner's reported coordinate is within a configurable radius (default ~50m) of the property's stored `location` point (which already exists as a PostGIS `geography` point from Spec 5). A client saying "I've arrived" is **advisory only**; the durable `ARRIVED` transition and its geofence-crossing fact are set by the server after the PostGIS check passes. Possession of the property's coordinates or a session id never authorizes arrival.

**Threat model — stated explicitly to avoid over-promising.** The server is authoritative for the geofence *computation* (the client cannot directly set `ARRIVED`), but the **reported GPS coordinates are client-provided telemetry and are NOT cryptographically proven physical location**. A malicious Cleaner can send a spoofed coordinate equal to the property location from anywhere; this spec does not claim anti-spoofing / physical-presence verification. Robust anti-spoofing (device attestation, location integrity APIs) is explicitly out of scope and, if ever required, is a separate, larger spec. What this spec guarantees: the *decision* is the server's, uses server-side computation over the property's stored location and the session's snapshotted radius, applies accuracy/staleness gates (below), and is the durable fact — not that the coordinate is physically authentic. (On-arrival video verification in Spec 18 is the human-presence check that complements this.)

**Authority split (kept strict):**
- **The matched offer owns who may participate.** A session belongs to one matched offer, so its only two participants are that offer's `hostId` and `cleanerId`. Only the Cleaner reports position and advances toward ARRIVED; only participants read the session; authorization is resolved server-side from the offer.
- **PostgreSQL is the source of truth for the session lifecycle + arrival fact.** Ephemeral position is never authoritative and never persisted.
- **Centrifugo is best-effort transport for live position + state signals.** The DB state machine is authoritative and reconciled via `GET`; a dropped position frame never corrupts session state, and a lost signal is recovered by reading the session.
- **Realtime tokens stay owned by auth** (the same ownership boundary chat/voip use for Centrifugo/LiveKit tokens): auth mints the session channel token after the participation rule passes; service-tracking only owns the participation rule.

**Durable events feed downstream specs (via the outbox pattern established in push-notifications).** Each durable state transition writes an outbox event in the same transaction as the state change: `service_en_route`, `service_arrived` (the geofence crossing), `service_started`. Those events are what push-notifications (Spec 16) turns into "Cleaner on the way / arrived" pushes, and what on-arrival video verification (Spec 18) reacts to. service-tracking does not call push or video directly; it emits durable facts and lets those specs react — no new coupling.

**Deliberate scope boundaries (to keep the MVP correct and shippable):**
- **A session is a matched-offer lifecycle, not a new domain.** No new participant model, no new authorization, no new payment. It reuses the offer/escrow already in place and the atomic offer state-machine pattern (`UPDATE ... WHERE state = expected`).
- **Position is ephemeral, not a route history.** No persistent breadcrumb trail, no analytics on movement, no ETA persistence in v1 (an ETA may be computed and shown live but is not a durable fact). If a persistent route log is ever needed, it gets its own spec with its own privacy review.
- **Geofence covers arrival at the property only.** One geofence: the property radius. No multi-point geofencing, no departure geofence, no dwell-time analytics in this spec.
- **The session ends its tracking role at IN_PROGRESS.** service-tracking takes the job from match to "Cleaner has arrived and started". On-arrival video verification (Spec 18), the checklist/photos (Spec 19), and completion + escrow release (Spec 20) are separate specs that react to or follow this session.
- **No SOS/panic, no in-app turn-by-turn navigation.** The plan's "open in Maps" hand-off and the SOS button are out of scope here (navigation is delegated to the OS maps app; SOS is a later safety spec).
- **Push delivery is not implemented here.** service-tracking emits durable `service_*` events; waking a backgrounded app with a push is push-notifications (Spec 16). Live in-app position/state uses the existing Centrifugo realtime path.
- **Correctness does not depend on immediate realtime delivery.** As with chat/voip, Centrifugo is best-effort; the `service_sessions` state machine plus `GET` reconciliation and server-side timeouts (a stale EN_ROUTE with no progress, an abandoned session) are the authoritative guarantees.

## Domain Model Overview

```
offers + escrow ── DURABLE FACT service_activation_ready (offer MATCHED AND escrow CAPTURED) ──► creates a session
        │ 1:1 (one service session per matched+charged offer). Emitted as ONE domain event (outbox),
        │ NOT computed by service-tracking querying offer.status AND payment.status separately.
        ▼
service_sessions (new — the durable execution lifecycle; never the live coordinates)
        id, offer_id (FK → offers ON DELETE CASCADE, UNIQUE — one session per offer),
        host_id (FK → users ON DELETE SET NULL), cleaner_id (FK → users ON DELETE SET NULL),
        property_id (FK → properties ON DELETE SET NULL; the geofence center),
        property_location_snapshot (geography; snapshot of the property point at creation — so the
          geofence survives a mid-session property deletion; see property-deletion policy below),
        state (MATCHED | EN_ROUTE | ARRIVED | IN_PROGRESS | CANCELED | EXPIRED),
        geofence_radius_m (INTEGER; snapshot of the configured radius at session creation),
        en_route_at (nullable), arrived_at (nullable), started_at (nullable),
        arrival_distance_m (nullable; server-observed distance at the geofence crossing),
        ended_reason (nullable: STARTED | CANCELED_OFFER_TERMINAL | CANCELED_BY_PARTICIPANT |
          EXPIRED_NO_PROGRESS | EXPIRED_NEVER_STARTED | EXPIRED_PROPERTY_REMOVED),
        created_at, updated_at
        (NO deleted_at; a session record is an immutable audit fact once terminal for tracking)

POSITION INGRESS (backend on the path — Option A; coordinates are client telemetry, not proof):
  Cleaner → POST /service-sessions/:id/position { lat, lng, accuracy, heading?, at }
     ├─ rate-limit per (user, session): drop samples faster than SERVICE_POSITION_MIN_INTERVAL_MS
     ├─ validate: accuracy ≤ SERVICE_POSITION_MAX_ACCURACY_M ; sample age (now - at) ≤ SERVICE_POSITION_MAX_AGE_MS
     ├─ run geofence (PostGIS) — see below
     └─ re-publish position to Centrifugo channel service:session:{id} (server → Host, best-effort)

LIVE POSITION (ephemeral — NEVER persisted):
  channel service:session:{id}  (SERVER publishes, Host subscribes read-only; token minted by auth
  after the participation rule). No breadcrumb row. The Cleaner is not a channel publisher.

GEOFENCE (server-authoritative computation, PostGIS; accuracy/staleness gated):
  eligible sample = accuracy ≤ SERVICE_POSITION_MAX_ACCURACY_M AND (server_now - at) ≤ SERVICE_POSITION_MAX_AGE_MS
  arrival check   = ST_DWithin(service_sessions.property_location_snapshot::geography,
                               ST_MakePoint(reportedLng, reportedLat)::geography,
                               geofence_radius_m)
                    (uses the SNAPSHOT taken at session creation, so a mid-session property deletion
                     does not break arrival evaluation)
  Only an ELIGIBLE sample passing the check sets the durable ARRIVED transition + arrival_distance_m,
  stamped with the SERVER's timestamp. A stale/low-accuracy sample is ignored for arrival (never errors).
  A client "arrived" claim is advisory and never sets the fact by itself.

SESSION STATE MACHINE (durable, single-winner conditional writes):
  MATCHED ──(Cleaner starts heading)──► EN_ROUTE ──(server geofence pass)──► ARRIVED
                                                              │
                                                    (Cleaner begins work) ──► IN_PROGRESS
  any non-terminal ──(offer terminal / cancel / stale / abandon / property removed)──► CANCELED | EXPIRED
    with differentiated ended_reason:
      CANCELED_OFFER_TERMINAL     (offer cancelled/expired/completed)
      CANCELED_BY_PARTICIPANT     (explicit cancel)
      EXPIRED_NO_PROGRESS         (EN_ROUTE stale: no eligible position within SERVICE_EN_ROUTE_STALE_MS)
      EXPIRED_NEVER_STARTED       (session never left MATCHED within SERVICE_SESSION_ABANDON_MS)
      EXPIRED_PROPERTY_REMOVED    (property deleted mid-session; see policy) — only if snapshot unusable
  terminal-for-tracking = { IN_PROGRESS (handed to Spec 18/19/20), CANCELED, EXPIRED }
  every transition: UPDATE service_sessions SET state=:next WHERE id=:id AND state=:expected
                    (winner sets timestamps + writes an outbox event in the SAME transaction)

DURABLE EVENTS (outbox, in the same tx as the transition — consumed by Spec 16 push / Spec 18 video):
  service_en_route { sessionId, offerId, cleanerId, hostId }
  service_arrived  { sessionId, offerId, arrivalDistanceM }     ──► unlocks on-arrival video (Spec 18)
  service_started  { sessionId, offerId }

RECONCILE PATH (authoritative state, independent of realtime):
  GET /service-sessions/:id        → current session record (state-machine truth; latest live pos is
                                       transient and only available via the realtime channel)
```

- A **service session** is a `service_sessions` row bound 1:1 to a matched offer; it inherits participants, authorization, and lifecycle coherence from that offer. It is not a chat/offer message and does not alter the offer's own state machine.
- **Live coordinates never transit persistence.** They flow over the session's Centrifugo channel, best-effort; only the session lifecycle and the arrival geofence-crossing fact are durable.
- **Arrival is a server fact.** The `ARRIVED` transition and `arrival_distance_m` are written only when the server's PostGIS geofence check passes; the client's claim is advisory.
- **Both roles** use the map surface: the Cleaner sees the destination and reports position while EN_ROUTE; the Host watches the approaching position and the state (on the way / arrived / started). Realtime is best-effort; both reconcile via `GET`.

## Glossary

- **Service session** — a `service_sessions` row: the durable execution lifecycle of a matched offer from `MATCHED` through `IN_PROGRESS`. Never holds live coordinates.
- **Live position** — the Cleaner's current `{ lat, lng, accuracy, heading?, at }`, transported over Centrifugo best-effort while EN_ROUTE. Ephemeral; never persisted as history.
- **Geofence** — the server-authoritative check (PostGIS `ST_DWithin`) that the Cleaner's reported coordinate is within `geofence_radius_m` of the property's stored `location`. Only a server-side pass sets `ARRIVED`.
- **Geofence crossing** — the durable fact that the geofence was satisfied: the `ARRIVED` transition + `arrival_distance_m`, and the `service_arrived` outbox event.
- **Session state machine** — the authoritative lifecycle in PostgreSQL: `MATCHED → EN_ROUTE → ARRIVED → IN_PROGRESS`, plus terminal `CANCELED | EXPIRED`. Transitions are single-winner conditional writes; terminal-for-tracking states are immutable.
- **Session channel** — `service:session:{id}` on Centrifugo, carrying live position + state signals; token minted by auth after the participation rule.
- **Stale/abandoned timeout** — the configured windows after which an EN_ROUTE session with no progress, or a session that never advances, is force-transitioned to `EXPIRED` by a server sweep, so no session is stuck.
- **Advisory client claim** — a client-sent "arrived"/position; input to the server's authoritative decision, never the decision itself.

## Requirements

### Requirement 1: A session exists for, and only for, a matched + charged offer

**User Story:** As a matched Host and Cleaner, I want a tracking session to begin automatically once the job is locked in, so that the Cleaner can head over and I can follow along — with exactly the person I matched with.

#### Acceptance Criteria

1. WHEN the domain emits the durable `service_activation_ready` fact (an offer is BOTH `MATCHED` AND its escrow is `CAPTURED`, expressed as **one durable domain event**, not as two separate cross-context status queries by service-tracking) THEN the system SHALL create exactly one `service_sessions` row for that offer (`UNIQUE offer_id`) with `state = MATCHED`, `host_id`/`cleaner_id` copied from the offer, `property_id` + `property_location_snapshot` (the geofence center captured at creation), and `geofence_radius_m` snapshotted from configuration — idempotently (a redelivered activation event never creates a second session).
2. WHEN session creation reacts to that fact THEN it SHALL be durable and recoverable (created off the same activation outbox event that other consumers use), and a failure to create the session SHALL NOT roll back or block the match/escrow. service-tracking SHALL NOT couple to the offer and payment bounded contexts by reading `offer.status` and `payment.status` independently; it consumes the single `service_activation_ready` fact.
3. WHEN any session endpoint is accessed THEN authorization SHALL be resolved server-side from the matched offer's `hostId`/`cleanerId`; a non-participant SHALL receive `403` and learn nothing about the session's existence.
4. WHEN an offer never reached `MATCHED` (or is not charged) THEN no session SHALL exist, and any attempt to start tracking SHALL be rejected.
5. WHEN more than one session creation is attempted for the same offer THEN the `UNIQUE offer_id` constraint SHALL guarantee at most one session (idempotent), never two.

### Requirement 2: Live position: ephemeral, participant-gated, best-effort

**User Story:** As a Host, I want to watch the Cleaner approach in real time, so that I know when to expect them — without the platform building a permanent trail of their movements.

#### Acceptance Criteria

1. WHEN the Cleaner is EN_ROUTE and reports position THEN it SHALL be sent to the **backend endpoint** `POST /service-sessions/:id/position` as `{ lat, lng, accuracy, heading?, at }` (Option A — the server is on the path); the server SHALL run the geofence check and THEN re-publish the position to the session's Centrifugo channel for the Host. The Cleaner SHALL NOT publish directly to Centrifugo.
2. WHEN position updates are handled THEN they SHALL NOT be persisted as a breadcrumb/route history in PostgreSQL — coordinates are ephemeral (evaluated then relayed); the sole durable location datum is the arrival `arrival_distance_m`.
3. WHEN position samples arrive faster than `SERVICE_POSITION_MIN_INTERVAL_MS` for a `(user, session)` THEN the server SHALL rate-limit/throttle them (drop or coalesce excess samples) so a flooding client cannot exhaust CPU / PostGIS / Centrifugo capacity; over-frequent samples SHALL be ignored, not errored.
4. WHEN the Host subscribes to the session channel THEN the subscription token SHALL be minted by auth after the server-side participation rule passes; possession of the channel name or session id SHALL NEVER by itself authorize subscription, and only the server publishes to the channel (the Host is a read-only subscriber; the Cleaner is not a channel publisher at all).
5. WHEN a non-participant attempts to post position, subscribe, or read a session THEN it SHALL be denied (`403` / no token), and no position data SHALL be exposed.
6. WHEN position frames or the relay are dropped/delayed THEN session correctness SHALL be unaffected (the authoritative state is the DB state machine, reconciled via `GET`); realtime delivery is never a correctness guarantee.

### Requirement 3: Server-authoritative geofence arrival

**User Story:** As the platform, I want arrival to be decided by the server based on real proximity, so that the "arrived" state is trustworthy and can gate video verification.

#### Acceptance Criteria

1. WHEN the Cleaner reports a coordinate near the property THEN the system SHALL decide arrival on the SERVER using PostGIS (`ST_DWithin` between the session's `property_location_snapshot` and the reported point, within the session's snapshotted `geofence_radius_m`); a client-sent "arrived" claim SHALL be advisory only and SHALL NOT by itself set the arrival fact. The reported coordinate is **client telemetry, not proof of physical presence** (see threat model); this criterion guarantees server-owned *computation*, not anti-spoofing.
2. WHEN a position sample is evaluated for arrival THEN it SHALL only be **eligible** if `accuracy ≤ SERVICE_POSITION_MAX_ACCURACY_M` AND its age (`server_now − at`) `≤ SERVICE_POSITION_MAX_AGE_MS` AND it is not future-dated beyond tolerated clock skew (`at ≤ server_now + SERVICE_POSITION_MAX_CLOCK_SKEW_MS`); an ineligible (low-accuracy, stale, or future-dated) sample SHALL be ignored for the arrival decision (never sets ARRIVED, never errors), so a 20m-distance / 150m-accuracy sample, a minutes-old sample, or a sample bearing a future `at` timestamp cannot declare arrival.
3. WHEN an eligible sample passes the geofence check for an EN_ROUTE session THEN the system SHALL transition `EN_ROUTE → ARRIVED` via a single-winner conditional write, set `arrived_at` (the **server** timestamp, not the client `at`) and the server-observed `arrival_distance_m`, and write a `service_arrived` outbox event in the same transaction.
4. WHEN the geofence check does not pass (or the sample is ineligible) THEN the session SHALL remain EN_ROUTE and no arrival fact SHALL be written, regardless of any client claim.
5. WHEN arrival is evaluated THEN it SHALL use the `property_location_snapshot` and `geofence_radius_m` captured on the session at creation, so neither a radius change in config nor a mid-session property edit/deletion retroactively alters an in-flight session's geofence.
6. WHEN the `service_arrived` event is emitted THEN it SHALL be the durable signal that on-arrival video verification (Spec 18) reacts to; service-tracking SHALL NOT itself start video verification (no direct coupling).
7. WHERE a sample carries a reported `accuracy` value, THE system SHALL treat `accuracy` solely as an eligibility gate (a sample is rejected when `accuracy > SERVICE_POSITION_MAX_ACCURACY_M`) and SHALL NOT use `accuracy` to mathematically widen, narrow, or otherwise correct the geofence radius; `arrival_distance_m` SHALL be the geometric geodesic distance from the reported point to the property, not an error-bounded distance. This is an accepted MVP simplification, documented rather than corrected.

### Requirement 4: Authoritative session state machine (single-winner, no stuck sessions)

**User Story:** As a participant, I want the session's state to be reliable and to always reach a resolution, so that both sides agree on where the job stands.

#### Acceptance Criteria

1. WHEN the Cleaner begins heading to the property THEN the system SHALL transition `MATCHED → EN_ROUTE` (single-winner conditional write), set `en_route_at`, and emit `service_en_route`.
2. WHEN the Cleaner begins the work after arriving THEN the system SHALL transition `ARRIVED → IN_PROGRESS` (single-winner), set `started_at`, and emit `service_started`; `IN_PROGRESS` is the hand-off point to Spec 18/19/20.
3. WHEN any actor drives a transition THEN it SHALL be a single-winner conditional write (`UPDATE ... WHERE id=:id AND state=:expected`); exactly one actor wins and sets the derived timestamps + the outbox event; concurrent losers observe zero rows and no-op.
4. WHEN a transition not permitted by the state machine is attempted THEN it SHALL be rejected and leave state unchanged; a session SHALL only move along `MATCHED → EN_ROUTE → ARRIVED → IN_PROGRESS` plus terminal `CANCELED | EXPIRED`, and terminal-for-tracking states SHALL be immutable.
5. WHEN a session must be force-expired THEN a bounded, idempotent server sweep SHALL do so via single-winner writes with a **differentiated `ended_reason`**: an EN_ROUTE session with no eligible position within `SERVICE_EN_ROUTE_STALE_MS` → `EXPIRED_NO_PROGRESS`; a session that never left MATCHED within `SERVICE_SESSION_ABANDON_MS` → `EXPIRED_NEVER_STARTED`; so no session is stuck and analytics/UX can distinguish the causes.
6. WHEN the underlying offer becomes terminal (cancelled/expired/completed) or the match is invalidated while the session is non-terminal THEN the system SHALL force-transition the session to `CANCELED` (`ended_reason = CANCELED_OFFER_TERMINAL`) as an idempotent side effect of the existing offer-terminal path, and SHALL reject further tracking on it. An explicit participant cancel SHALL use `CANCELED_BY_PARTICIPANT`.
7. WHEN the property is deleted while the session is non-terminal THEN because the geofence uses `property_location_snapshot` (not the live property row), arrival evaluation SHALL continue to work; the session SHALL NOT break. Only if the snapshot is unavailable/unusable SHALL the session be force-expired with `ended_reason = EXPIRED_PROPERTY_REMOVED`. (`property_id` remains `ON DELETE SET NULL` for referential coherence; the snapshot is what the geofence depends on.)
8. WHEN session state is read via `GET` THEN it SHALL reflect the authoritative PostgreSQL state machine independent of realtime delivery, so both clients can always reconcile after a dropped connection.

### Requirement 5: Mobile tracking UX for both roles

**User Story:** As a Cleaner I want to share my approach and mark that I've started, and as a Host I want to watch the Cleaner arrive, so that the hand-off is smooth and clear.

#### Acceptance Criteria

1. WHEN the session is EN_ROUTE and the Cleaner has granted location permission THEN the Cleaner app SHALL send position samples to the backend position endpoint (`POST /service-sessions/:id/position`) — the server re-publishes to the Host — and show the destination and (optionally) a live ETA; a live ETA MAY be shown but is not a durable fact. The Cleaner app SHALL NOT publish position directly to the session channel.
2. WHEN the Host opens the active job THEN the Host app SHALL render the Cleaner's live position on the map (Mapbox rendering the position transported by Centrifugo) and the current session state (on the way / arrived / started), reconciling via `GET`.
3. WHEN location permission is denied or unavailable on the Cleaner device THEN the app SHALL degrade gracefully with an i18n explanation (never crash), the session SHALL still function via server-side geofence checks on any coordinates the Cleaner does provide, and the Host SHALL see a clear "location unavailable" state rather than a stale position.
4. WHEN the geofence confirms arrival THEN both apps SHALL reflect the `ARRIVED` state promptly (realtime, reconciled by `GET`), and the Host SHALL see a clear "Cleaner has arrived" indication.
5. WHEN any UI text is rendered THEN it SHALL come from i18n keys with `en` and `es` in parity, and colors/spacing SHALL follow the BidClean dark design tokens (consistent with the radar/chat screens).
6. WHEN the map is shown THEN it SHALL use Mapbox for rendering only; the platform SHALL NOT treat Mapbox as the source of truth for position or arrival (that is Centrifugo transport + the server geofence).

### Requirement 6: Configuration, security, and no hardcoded values

**User Story:** As an operator, I want tracking behavior and thresholds driven by configuration, so that the feature is portable, private, and leaks no secrets.

#### Acceptance Criteria

1. WHEN service-tracking reads any tunable (`SERVICE_GEOFENCE_RADIUS_M`, `SERVICE_POSITION_MIN_INTERVAL_MS` (server-side rate limit), `SERVICE_POSITION_MAX_ACCURACY_M`, `SERVICE_POSITION_MAX_AGE_MS`, `SERVICE_POSITION_MAX_CLOCK_SKEW_MS`, `SERVICE_POSITION_CHANNEL_PREFIX`, `SERVICE_POSITION_TOKEN_TTL_SECONDS`, `SERVICE_EN_ROUTE_STALE_MS`, `SERVICE_SESSION_ABANDON_MS`, `SERVICE_SWEEP_INTERVAL_MS`, `SERVICE_SWEEP_BATCH_SIZE`, and mobile `EXPO_PUBLIC_SERVICE_POSITION_MIN_INTERVAL_MS` (client-side send cadence)) THEN it SHALL come from environment/config constants with none hardcoded in logic, and a fail-fast `validateServiceTrackingConfig()` SHALL run at startup for required values (consistent with `validateChatConfig`). Note the min-interval exists on both sides: the client throttles sending, and the **server independently rate-limits** (never trusting the client to self-limit).
2. WHEN a session channel token is minted THEN the Centrifugo signing secret SHALL be read from server configuration (reusing `CENTRIFUGO_TOKEN_SECRET`), never shipped to the client except as the time-boxed token, and the token SHALL scope only the Host to subscribe (read-only) on that one session channel; no publish grant SHALL be issued to the Cleaner (the server is the sole publisher).
3. WHEN live position is handled THEN coordinates SHALL NOT be persisted or logged as a trail, and no participant PII (phone/email) SHALL be placed in position payloads or logs; the only durable location datum is `arrival_distance_m`.
4. WHEN the mobile client needs realtime config THEN it SHALL read Centrifugo/Mapbox config from `EXPO_PUBLIC_*` or server responses, never from hardcoded literals or embedded secrets (Mapbox token handling consistent with the radar screen).
5. WHEN a new backend entity, migration, realtime channel, auth token surface, or mobile feature is introduced THEN it SHALL be documented (module READMEs, ARCHITECTURE diagram + a service-tracking lifecycle flow, CHANGELOG, and an ADR for the ephemeral-position + server-authoritative-geofence decision) per the project documentation rules.

### Requirement 7: Persistence, lifecycle, and integrity

**User Story:** As the platform, I want session data modeled correctly and coherently with the rest of the system, so that history is truthful and privacy-respecting.

#### Acceptance Criteria

1. WHEN the `service_sessions` table is created THEN it SHALL follow the project database standards: UUID PK, snake_case, `timestamptz` timestamps, explicit FK `ON DELETE` behavior, application-validated `VARCHAR` for `state`/`ended_reason` (not PG enums; `ended_reason` includes the differentiated values `STARTED|CANCELED_OFFER_TERMINAL|CANCELED_BY_PARTICIPANT|EXPIRED_NO_PROGRESS|EXPIRED_NEVER_STARTED|EXPIRED_PROPERTY_REMOVED`), a `geography` `property_location_snapshot` (the geofence center, decoupled from the live property row), `UNIQUE offer_id`, and indexes on every FK and a partial index over non-terminal `state` for the sweep. It SHALL NOT have a `deleted_at` (a terminal-for-tracking session is an immutable audit fact) and SHALL NOT have any location-history / breadcrumb column (only the single scalar `arrival_distance_m`).
2. WHEN a session's parent offer cascades away THEN its `service_sessions` row SHALL cascade with it (`offer_id` → CASCADE); no location cleanup is required because live position is never persisted.
3. WHEN a user account is deleted THEN sessions SHALL follow the same coherence rule as chat/calls (Spec 13 invariant): `host_id`/`cleaner_id`/`property_id` are `ON DELETE SET NULL` (identity anonymized), the session record is retained per the central retention policy, and no session history is destroyed merely because a participant is deleted. **service-tracking MUST NOT reintroduce a user-cascade path.**
4. WHEN a session transitions state THEN each transition SHALL be written atomically with its derived fields (`en_route_at`/`arrived_at`/`started_at`/`arrival_distance_m`/`ended_reason`) and its outbox event, so history can never observe an `ARRIVED` session without `arrived_at`, or a `service_arrived` event without a committed arrival.
5. WHEN the arrival fact is stored THEN only the server-observed `arrival_distance_m` (a single scalar) SHALL persist as location-derived data — never the raw coordinate stream.

## Correctness Properties (business invariants)

The design defines concrete, testable properties (its own numbering) mapping back to these.

- **REQ-ST1 — Session is a matched+charged-offer lifecycle, from one durable fact.** Exactly one `service_sessions` row per offer (`UNIQUE offer_id`), created idempotently in reaction to the single durable `service_activation_ready` fact (offer MATCHED AND escrow CAPTURED — not two cross-context queries); it inherits the offer's participant isolation and never alters the offer's own state machine. *(Req 1.1, 1.2, 1.5, 4.4)*
- **REQ-ST2 — Participant isolation.** Every session read/action and every channel subscription is authorized server-side from the matched offer's parties; a non-participant is denied and learns nothing; a session id / channel name never authorizes. *(Req 1.3, 2.3, 2.4)*
- **REQ-ST3 — Position ingress via API; position is ephemeral.** Position is sent to the backend endpoint (Option A), evaluated server-side, then re-published by the server to the Host over Centrifugo (the Cleaner never publishes to the channel). Coordinates are never persisted as history; the sole durable location datum is `arrival_distance_m`. *(Req 2.1, 2.2, 2.4, 6.3, 7.5)*
- **REQ-ST4 — Server-authoritative geofence (computation), accuracy/staleness/skew gated.** Arrival is set only by the server's PostGIS `ST_DWithin` against the session's `property_location_snapshot` + snapshotted radius, only for an *eligible* sample (`accuracy ≤ max`, age `≤ max`, and not future-dated beyond tolerated clock skew), stamped with the server timestamp; `accuracy` is an eligibility gate only (never a radius correction) and `arrival_distance_m` is the geometric distance; a client claim is advisory. *(Req 3.1, 3.2, 3.3, 3.4, 3.5, 3.7)*
- **REQ-ST4b — GPS threat model (no over-promise).** The server owns the geofence *computation*, but reported coordinates are client telemetry, not cryptographic proof of physical location; this spec does not claim anti-spoofing (human presence is complemented by Spec 18). *(Introduction threat model, Req 3.1)*
- **REQ-ST5 — Durable-first transitions + outbox.** Every state transition is committed with its derived timestamps and its outbox event in one transaction; `service_arrived` is the durable signal Spec 18 reacts to; a realtime failure never loses a transition. *(Req 3.2, 4.1, 4.2, 7.4)*
- **REQ-ST6 — Single-winner, monotonic state machine.** Lifecycle follows `MATCHED → EN_ROUTE → ARRIVED → IN_PROGRESS` plus terminal `CANCELED|EXPIRED`; illegal transitions rejected; terminal-for-tracking immutable; every terminal/advancing write is single-winner. *(Req 4.1–4.4)*
- **REQ-ST7 — No stuck session, differentiated causes.** A stale EN_ROUTE (`EXPIRED_NO_PROGRESS`), a never-started session (`EXPIRED_NEVER_STARTED`), a terminal offer (`CANCELED_OFFER_TERMINAL`), an explicit cancel (`CANCELED_BY_PARTICIPANT`), or an unusable-snapshot property removal (`EXPIRED_PROPERTY_REMOVED`) each converge via a bounded single-winner sweep with a distinct `ended_reason`; state is always recoverable via `GET`. *(Req 4.5, 4.6, 4.7, 4.8)*
- **REQ-ST11 — Server-side rate limiting.** Position samples faster than the configured min interval per `(user, session)` are throttled/ignored server-side (never trusting the client to self-limit), bounding CPU/PostGIS/Centrifugo load. *(Req 2.3, 6.1)*
- **REQ-ST12 — Geofence survives property deletion.** Because the geofence uses `property_location_snapshot`, deleting the property mid-session does not break arrival evaluation; only an unusable snapshot expires the session. *(Req 3.5, 4.7)*
- **REQ-ST8 — Server-only broadcast (read-only Host).** Only the server publishes position to the session channel (after ingesting the Cleaner's `POST`); the Cleaner is not a channel publisher, and the Host is a read-only subscriber — enforced by token grants that issue no publish scope. *(Req 2.1, 2.4, 6.2)*
- **REQ-ST9 — Deletion coherence.** Deleting/anonymizing a participant nulls `host_id`/`cleaner_id`/`property_id` but never destroys session history; no user-cascade path (Spec 13 invariant). *(Req 7.3)*
- **REQ-ST10 — No hardcoded config/secrets.** Radius, TTLs, timeouts, sweep tuning come from config with fail-fast validation; Centrifugo secret/Mapbox token never shipped to the client; coordinates never logged/persisted as a trail. *(Req 6.1–6.4)*

## Non-Goals

- A new participant, authorization, or payment model — a session is a lifecycle on a matched offer, authorized by the offer's two parties, over an auth-minted session channel.
- A persistent breadcrumb/route history, movement analytics, or durable ETA — live position is ephemeral Centrifugo transport only.
- Multi-point geofencing, departure geofence, or dwell-time analytics — only property-arrival is in scope.
- On-arrival video verification (Spec 18), the checklist/photos (Spec 19), or completion + escrow release (Spec 20) — service-tracking hands off at `IN_PROGRESS` via durable events.
- SOS/panic button or in-app turn-by-turn navigation — delegated to the OS maps app / a later safety spec.
- Push notification delivery / OS wake-up — service-tracking emits durable `service_*` events; delivery is push-notifications (Spec 16).
- Treating Mapbox as a source of truth for position or arrival, proxying coordinates through persistence, or exposing any public session channel.
- Any change to the offer/negotiation/escrow contracts beyond creating the session in reaction to `MATCHED` and force-cancelling it on offer-terminal.
