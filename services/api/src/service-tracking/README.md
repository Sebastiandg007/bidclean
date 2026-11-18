# service-tracking (Spec 17)

## Purpose
Owns the post-match, pre-work execution phase: the Cleaner heads to the property, the Host watches the live position approach, and a **server-authoritative geofence** confirms arrival and unlocks on-arrival video verification (Spec 18). A `service_sessions` row is a durable execution lifecycle bound 1:1 to a matched+charged offer (`MATCHED → EN_ROUTE → ARRIVED → IN_PROGRESS`, plus terminal `CANCELED | EXPIRED`). It is not a new participant, authorization, or payment model — authorization is resolved server-side from the offer's two parties. Live position is **ephemeral** (evaluated then relayed, never persisted); the sole durable location datum is `arrival_distance_m`.

## Files
| File | Responsibility |
|------|---------------|
| `service-tracking.constants.ts` | All `SERVICE_*` config (radius, intervals, TTLs, sweep tuning) + `validateServiceTrackingConfig()` fail-fast + channel helpers |
| `service-tracking.types.ts` | `SessionState`/`EndedReason` unions, `PositionSample`, `EligibilityConfig`, `GeofenceResult`, `ActivationPayload`, `ServiceSessionView`, error strings |
| `service-activation-outbox.ts` | Builder for the upstream `service_activation_ready` fact (written by the offer/escrow path into `service_activation_outbox`) |
| `service-outbox.ts` | Builders for the `service_en_route`/`service_arrived`/`service_started` events + the fan-out consumer names |
| `entities/*.entity.ts` | TypeORM entities for `service_sessions`, `service_outbox`, `service_outbox_consumers`, `service_activation_consumed` |
| `geofence.service.ts` | Pure `isEligible` gate (accuracy/age/clock-skew) + PostGIS `isWithinGeofence` over the snapshot |
| `position-rate-limiter.ts` | Server-side `SET NX PX` throttle per `(user, session)` (Redis; fails open) |
| `service-session-participation.service.ts` | The single participation rule (`isParticipant`), shared with the auth token endpoint |
| `service-session.repository.ts` | Parameterized SQL: idempotent create, single-winner `transition` (+ outbox in one tx), geofence, sweep + per-consumer outbox + activation cursor queries |
| `service-session.service.ts` | State machine + position ingress (Option A) + best-effort re-publish; the `SERVICE_REALTIME_PUBLISHER` seam |
| `service-activation.consumer.ts` | Drains `service_activation_ready` via its own `service_activation_consumed` checkpoint (idempotent create) |
| `service-outbox-consumer.checkpoint.ts` | The fan-out primitive: `drainUnacked(consumer)` / `ack(eventId, consumer)` |
| `offer-terminal-session.listener.ts` | `@OnEvent` offer cancelled/expired/completed → idempotent force-cancel |
| `service-sweep.processor.ts` | Bounded, idempotent BullMQ sweep: abandon (`EXPIRED_NEVER_STARTED`) + stale (`EXPIRED_NO_PROGRESS`) |
| `service-session.controller.ts` | `@Controller('service-sessions')` — GET / en-route / position / start / cancel (JWT-guarded, participant-gated) |
| `service-tracking.module.ts` | Wires providers + the sweep queue; binds `SERVICE_REALTIME_PUBLISHER` to `CentrifugoClient`; exports `ServiceSessionParticipationService` |

## Dependencies
- **OffersModule** — reuses `CentrifugoClient` (best-effort position/state re-publish) and offer domain events.
- **AuthModule** — imports this module and calls `ServiceSessionParticipationService` to mint the `service:session:{id}` subscription token (auth owns tokens, service-tracking owns the participation rule).
- **payments/escrow** — the upstream emitter of `service_activation_ready` (see the seam below); read-only, one-directional.
- Redis/BullMQ (rate limiter + sweep), PostgreSQL + PostGIS.

## Upstream seam — `service_activation_ready`
The offer/escrow path (`payments/escrow/escrow-charge.service.ts`) writes a `service_activation_ready` row into the dedicated **`service_activation_outbox`** table in the SAME transaction as the escrow HELD transition (payload `{ offerId, hostId, cleanerId, propertyId }`, `event_id = service_activation_ready:<offerId>`). It uses `markChargeSucceeded(..., extraOutbox)`. service-tracking drains it via its own `service_activation_consumed` cursor — it never mutates a shared `relayed_at`. A dedicated table (not `payment_outbox`) is required because the notifications relay marks unknown-type `payment_outbox` rows relayed and would silently drop the fact.

## API
| Method | Path | Description |
|--------|------|-------------|
| GET | `/service-sessions/:id` | Participant-gated reconciliation (authoritative state) |
| POST | `/service-sessions/:id/en-route` | Cleaner marks heading out (`MATCHED → EN_ROUTE`) |
| POST | `/service-sessions/:id/position` | Cleaner reports `{ lat, lng, accuracy, heading?, at }` (rate-limited, geofence-evaluated, re-published) |
| POST | `/service-sessions/:id/start` | Cleaner begins work (`ARRIVED → IN_PROGRESS`) |
| POST | `/service-sessions/:id/cancel` | Explicit participant cancel (`CANCELED_BY_PARTICIPANT`) |

## Environment Variables
See `.env.example` (`SERVICE_*` block). All required values are validated at startup by `validateServiceTrackingConfig()`. `CENTRIFUGO_TOKEN_SECRET` / `CENTRIFUGO_API_URL` / `CENTRIFUGO_API_KEY` are reused.

## Realtime channel
`service:session:{id}` is an **output** transport (server → Host). The Host subscribes read-only (token minted by auth); the Cleaner never publishes (Option A). A dropped frame never corrupts state — the DB state machine is authoritative, reconciled via `GET`.
