# Offers Module

## Purpose

Manages the full offer lifecycle for cleaning services: creation, publishing, progressive delivery via tiered radius expansion, commission calculation, and state management. Hosts create offers tied to their properties, propose a price, and the system delivers the offer to nearby verified Cleaners in tiers (Favorites → PRO → FREE) with configurable delays and expanding search radius via BullMQ delayed jobs.

## Files

| File | Responsibility |
|------|---------------|
| `offers.module.ts` | NestJS module registration (providers, controllers, imports, exports) |
| `offers.controller.ts` | REST endpoints for offer CRUD and lifecycle actions |
| `offers.service.ts` | Core business logic: create, publish, cancel, query |
| `offers.repository.ts` | Database operations with optimistic locking |
| `offers.types.ts` | Enums (OfferState, ServiceType, DeliveryTier, etc.) and interfaces |
| `offers.constants.ts` | Environment-derived configuration and state transition map |
| `commission/commission.service.ts` | Integer-only commission calculation (Host fee + Cleaner commission) |
| `commission/commission.types.ts` | Commission-specific type definitions |
| `delivery/delivery-scheduler.service.ts` | Tiered delivery orchestration (Favorites → PRO → FREE) |
| `delivery/tier-delivery.processor.ts` | BullMQ worker for delayed tier delivery (PRO/FREE) with stale-job guard |
| `delivery/favorites-window.processor.ts` | BullMQ worker for favorites window expiration trigger |
| `delivery/delivery.types.ts` | Delivery-specific types |
| `delivery/centrifugo.client.ts` | Centrifugo HTTP API client for real-time WebSocket delivery |
| `discovery/cleaner-discovery.interface.ts` | Contract interface for Cleaner geospatial discovery |
| `discovery/cleaner-discovery.service.ts` | Stub implementation (returns empty until cleaner module exists) |
| `discovery/cleaner-discovery.types.ts` | Discovery parameter and result types |
| `queues/offer-queue.types.ts` | BullMQ job payload types for all 4 queues (TierDeliveryJobData, FavoritesWindowJobData, PushNotificationJobData) |
| `queues/offer-queue.constants.ts` | Default job options (retry + exponential backoff), queue configs, job name constants |
| `queues/offer-queues.module.ts` | NestJS module registering all 4 BullMQ queues with configurable retry/backoff |
| `queues/index.ts` | Barrel export for queue types, constants, and module |
| `expansion/radius-expansion.processor.ts` | BullMQ worker for progressive radius expansion (stale-job guard, cleaner discovery, delivery, expiration) |
| `expansion/radius-expansion.types.ts` | Job payload (with isFinalWait) and result types for expansion |
| `expansion/radius-expansion.property.spec.ts` | Property-based tests: monotonicity (capped) + stale job idempotency |
| `expansion/stale-job.guard.ts` | Utility to detect and skip stale BullMQ jobs |
| `notification/offer-notification.service.ts` | Push notification fallback for offline Cleaners (delegates to OneSignalClient) |
| `notification/push-notification.processor.ts` | BullMQ worker for push notification delivery via OneSignal |
| `notification/onesignal.client.ts` | OneSignal REST API client (HTTP POST to /notifications endpoint) |
| `notification/notification.constants.ts` | Push notification content constants (headings, body, data type) |
| `contracts/property-readiness.interface.ts` | Cross-module contract interface with PropertyReadinessFailure type |
| `contracts/property-readiness.service.ts` | Default implementation using DataSource for cross-table validation |
| `contracts/offer-match.interface.ts` | Cross-module contract for offer matching (ACTIVE → MATCHED) |
| `contracts/offer-match.service.ts` | Concrete implementation of OfferMatchContract (validates ACTIVE, transitions to MATCHED, sets matched_at) |
| `events/offer-domain-events.ts` | Domain event type definitions and event name constants |
| `events/offer-event-emitter.service.ts` | EventEmitter2-based domain event emission with typed methods |
| `state-machine/offer-state-machine.ts` | Pure state transition validation function |
| `state-machine/offer-state-machine.spec.ts` | Unit tests for state machine |
| `state-machine/offer-state-machine.property.spec.ts` | Property-based tests for state machine transitions |
| `__tests__/offers-cancel.service.spec.ts` | Unit tests for cancel flow (10 tests: state validation, ownership, jobs, notifications, race conditions) |
| `__tests__/radius-expansion.processor.spec.ts` | Unit tests for RadiusExpansionProcessor (8 tests: stale jobs, expansion, discovery, scheduling, expiration) |
| `__tests__/centrifugo.client.spec.ts` | Unit tests for CentrifugoClient (14 tests: publish, broadcast, retry, exponential backoff, error handling) |
| `__tests__/onesignal.client.spec.ts` | Unit tests for OneSignalClient (12 tests: delivery, config validation, HTTP errors, network errors) |
| `__tests__/offer-notification.service.spec.ts` | Unit tests for OfferNotificationService (8 tests: payload building, success/failure, error handling) |
| `__tests__/offers.service.property.spec.ts` | Property-based tests for create flow (price, duration, scheduling, idempotency, duplicates, required fields) |
| `__tests__/commission.service.spec.ts` | Unit tests for commission calculations |
| `dto/create-offer.dto.ts` | Create offer request validation |
| `dto/publish-offer.dto.ts` | Publish offer request validation |
| `dto/offer-query.dto.ts` | Query/pagination parameters |
| `dto/offer-response.dto.ts` | Response shapes including price breakdown |
| `entities/offer.entity.ts` | TypeORM entity for offers table |
| `entities/offer-state-transition.entity.ts` | TypeORM entity for audit trail |
| `entities/offer-delivery.entity.ts` | TypeORM entity for delivery tracking |
| `guards/offer-owner.guard.ts` | NestJS CanActivate guard: extracts offerId from route params, resolves internal user by keycloakId, queries offer WHERE id AND host_id, throws ForbiddenException if not owner or not found |
| `__tests__/offers.controller.property.spec.ts` | Property-based tests for controller (ownership isolation, list filtering, audit completeness) |

## Database

### Tables
| Table | Migration | Description |
|-------|-----------|-------------|
| `offers` | `1700000010000-CreateOffersTable` | Core offers table with pricing (cents), state machine, property snapshots, radius tracking, idempotency |
| `offer_state_transitions` | `1700000011000-CreateOfferStateTransitionsTable` | Audit log tracking every lifecycle state change (from_state → to_state, triggered_by, metadata JSONB) |
| `offer_deliveries` | `1700000012000-CreateOfferDeliveriesTable` | Tracks each delivery attempt to a Cleaner: tier (FAVORITE/PRO/FREE), status (PENDING/SENT/FAILED), channel (WEBSOCKET/PUSH), radius step |

### Entities
| Entity | File | Description |
|--------|------|-------------|
| `Offer` | `entities/offer.entity.ts` | Full TypeORM entity with all columns, CHECK constraints, indexes, and relations to User/Property/Transitions/Deliveries |
| `OfferStateTransition` | `entities/offer-state-transition.entity.ts` | Audit trail entity recording from_state, to_state, triggered_by, and JSONB metadata per transition |
| `OfferDelivery` | `entities/offer-delivery.entity.ts` | Delivery tracking entity with tier, status, channel, radius_step, and unique constraint per (offer, cleaner) |

### Key Constraints
- `chk_state` — Allowed states: DRAFT, PUBLISHED, ACTIVE, MATCHED, COMPLETED, CANCELLED, EXPIRED
- `chk_service_type` — Allowed types: standard, deep, move_in_out, post_construction, post_event, recurring
- `chk_price_positive` — offered_price_cents > 0
- `chk_host_total` — host_total_cents = offered_price_cents + host_service_fee_cents
- `chk_cleaner_payout` — cleaner_payout_cents = offered_price_cents - cleaner_commission_cents
- `uq_one_active_offer_per_property` — Only one DRAFT/PUBLISHED/ACTIVE offer per property
- `uq_offers_idempotency` — Prevents duplicate offer creation on retry

## Dependencies

### Internal Modules
- **Properties module** — via `PropertyReadinessInterface` contract (DI token)
- **Auth module** — `JwtAuthGuard` for authentication
- **Roles module** — `OnboardingGateGuard` for Host role enforcement

### External Services
- **PostgreSQL + PostGIS** — Source of truth for offers, transitions, deliveries
- **Redis + BullMQ** — Job scheduling for radius expansion, tier delivery, push notifications
- **Centrifugo** — Real-time WebSocket delivery to Cleaners (transport only)
- **OneSignal** — Push notification fallback for offline Cleaners

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/offers` | Create a new offer (DRAFT state) |
| POST | `/offers/:id/publish` | Publish an offer (DRAFT → PUBLISHED) |
| POST | `/offers/:id/cancel` | Cancel an offer |
| GET | `/offers` | List own offers (paginated, state-filterable) |
| GET | `/offers/:id` | Get offer detail with state history |
| GET | `/offers/:id/price-breakdown` | Get price breakdown (Host or Cleaner view) |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OFFER_HOST_FEE_RATE` | Host service fee in basis points (default: 1000 = 10%) | No |
| `OFFER_CLEANER_RATE` | Cleaner commission in basis points (default: 300 = 3%) | No |
| `OFFER_INITIAL_RADIUS` | Initial search radius in meters (default: 3000) | No |
| `OFFER_EXPANSION_STEP` | Radius expansion step in meters (default: 2000) | No |
| `OFFER_MAX_RADIUS` | Maximum search radius in meters (default: 25000) | No |
| `OFFER_EXPANSION_INTERVAL_MS` | Interval between expansions in ms (default: 300000) | No |
| `OFFER_FINAL_WAIT_MS` | Final wait before expiration in ms (default: 600000) | No |
| `OFFER_FAVORITES_WINDOW_MS` | Favorites-first window in ms (default: 180000) | No |
| `OFFER_PRO_FREE_DELAY_MS` | Delay between PRO and FREE delivery in ms (default: 120000) | No |
| `OFFER_MIN_LEAD_MINUTES` | Minimum lead time for scheduling (default: 60) | No |
| `OFFER_MIN_DURATION_MINUTES` | Minimum offer duration (default: 30) | No |
| `OFFER_MAX_DURATION_MINUTES` | Maximum offer duration (default: 480) | No |
| `OFFER_MAX_RETRIES` | Max BullMQ job retries (default: 3) | No |
| `OFFER_BACKOFF_DELAY_MS` | Backoff delay for retries in ms (default: 5000) | No |
| `CENTRIFUGO_API_URL` | Centrifugo server API base URL | Yes |
| `CENTRIFUGO_API_KEY` | Centrifugo API authorization key | Yes |
| `ONESIGNAL_APP_ID` | OneSignal application identifier | Yes |
| `ONESIGNAL_API_KEY` | OneSignal REST API key | Yes |

## BullMQ Queues

All offer queues share configurable retry + exponential backoff from environment variables.

| Queue | Job Name | Trigger | Purpose |
|-------|----------|---------|---------|
| `offer-radius-expansion` | `expand-radius` | Delayed (expansion interval) | Expands search radius, discovers new Cleaners |
| `offer-tier-delivery` | `deliver-to-tier` | Delayed (tier delay) | Delivers offer to PRO or FREE tier |
| `offer-favorites-window` | `favorites-expired` | Delayed (favorites window) | Triggers PRO delivery after favorites window |
| `offer-push-notification` | `send-push` | Immediate | Sends push notification via OneSignal |

### Default Job Options
- **Max retries:** `OFFER_MAX_RETRIES` (default: 3)
- **Backoff type:** Exponential
- **Backoff delay:** `OFFER_BACKOFF_DELAY_MS` (default: 5000ms)
- **Remove on complete:** Yes
- **Remove on fail:** No (kept for debugging)

### Stale Job Guard Pattern

Every job payload includes `{ offerId, expectedState, expectedStep }`. Before processing, the processor validates all fields match the current database state. If stale, the job completes silently — no retry, no error.

## State Machine

```
DRAFT → PUBLISHED → ACTIVE → MATCHED → COMPLETED
  ↓         ↓          ↓
CANCELLED  CANCELLED  CANCELLED
            ↓          ↓
          EXPIRED    EXPIRED
```

## Cancellation Flow

The cancel flow (`OffersService.cancel()`) handles three states with different side effects:

| Previous State | Cancel Pending Jobs | Notify Cleaners |
|----------------|--------------------|-----------------| 
| DRAFT | No (no jobs exist) | No |
| PUBLISHED | Yes (delayed + waiting) | No |
| ACTIVE | Yes (delayed + waiting) | Yes (Centrifugo broadcast) |

**Steps:**
1. Validate ownership and cancellable state (DRAFT, PUBLISHED, ACTIVE)
2. Transition to CANCELLED via state machine (optimistic locking)
3. Set `cancelled_at` timestamp
4. Cancel BullMQ jobs matching offerId (if PUBLISHED or ACTIVE)
5. Broadcast `offer_cancelled` to delivered Cleaners' channels (if ACTIVE)
6. Emit `OfferCancelled` domain event with `previousState`

Non-cancellable states (MATCHED, COMPLETED, CANCELLED, EXPIRED) return `422 Unprocessable Entity`.

## Notification Service (Push Fallback)

The `OfferNotificationService` + `OneSignalClient` provide push notification delivery to offline Cleaners when WebSocket (Centrifugo) delivery fails.

### Flow

1. `DeliverySchedulerService.attemptPush()` calls `OfferNotificationService.sendOfferNotification(cleanerId, offerId)`
2. `OfferNotificationService` builds a structured payload (headings, contents, deep-link data) from constants
3. `OneSignalClient.sendToUser()` sends HTTP POST to OneSignal REST API (`/notifications`)
4. Targets Cleaner by external user ID (`include_external_user_ids`)
5. Returns `true` if OneSignal accepts, `false` on any error (never throws)
6. On success, `DeliverySchedulerService` updates the delivery record channel to `PUSH`

### Error Handling

- **No retries in the client** — BullMQ handles retries at the queue level
- **Never throws** — all errors caught internally, logged, return `false`
- **Graceful degradation** — missing configuration disables push silently

### Payload Structure

```typescript
{
  headings: { en: '...', es: '...' },
  contents: { en: '...', es: '...' },
  data: { type: 'offer_new', offerId: '<uuid>' }
}
```

## Radius Expansion Processor

The `RadiusExpansionProcessor` is a BullMQ worker that progressively expands the search radius for an offer, discovering new Cleaners at each step.

### Flow

1. **Stale Job Guard**: Validates `offer.state` matches `expectedState` and `offer.expansionStepCount` matches `expectedStep`. Stale jobs complete silently.
2. **Radius Calculation**: `newRadius = Math.min(currentRadius + EXPANSION_STEP_M, MAX_RADIUS_M)` via pure `calculateExpandedRadius()` function.
3. **Cleaner Discovery**: Calls `CleanerDiscoveryInterface.findEligibleCleaners()` with expanded radius, excluding already-delivered cleaner IDs.
4. **Delivery**: Triggers `DeliverySchedulerService.deliverToCleaners()` with discovered Cleaners.
5. **Update**: Persists new radius + incremented step count via `OffersRepository.updateRadiusExpansion()`.
6. **Next Job**: If `newRadius < MAX_RADIUS_M` → enqueue next expansion (delay: `EXPANSION_INTERVAL_MS`). If `newRadius >= MAX_RADIUS_M` → enqueue final-wait (delay: `FINAL_WAIT_MS`) with `isFinalWait: true`.
7. **Final Wait Expiration**: If `isFinalWait` is true and offer is still PUBLISHED/ACTIVE → transition to EXPIRED, set `expired_at`, emit `OfferExpired` event.

### Pure Function (Exported for Testing)

```typescript
calculateExpandedRadius(initialRadius, step, stepSize, maxRadius): number
```

## Delivery Scheduler

The `DeliverySchedulerService` orchestrates tiered offer delivery to Cleaners:

### Flow

1. **`deliverToCleaners(offerId, cleaners, radiusStep)`** — Main entry point:
   - Partitions discovered Cleaners by tier (FAVORITE, PRO, FREE)
   - If `favoritesFirst` AND favorites exist → deliver favorites immediately, schedule PRO after `FAVORITES_WINDOW_MS`, FREE after `FAVORITES_WINDOW_MS + PRO_FREE_DELAY_MS`
   - Otherwise → deliver PRO immediately, schedule FREE after `PRO_FREE_DELAY_MS`

2. **`deliverToSingleCleaner(offerId, cleanerId, tier, radiusStep)`** — Per-cleaner:
   - Creates PENDING delivery record
   - Attempts WebSocket via Centrifugo (`offers:cleaner:{cleanerId}`)
   - Falls back to push via OneSignal
   - Updates delivery status to SENT (with channel) or FAILED (with reason)
   - Triggers PUBLISHED → ACTIVE on FIRST successful delivery

3. **`scheduleTierDelivery(...)`** — Enqueues delayed BullMQ job for tier delivery
4. **`processTierDeliveryJob(jobData)`** — Stale-job guard + iterates delivery

### PUBLISHED → ACTIVE Trigger

On the first SENT delivery, the service:
- Transitions state via optimistic locking (`OfferStateMachineService`)
- Emits `OfferActivated` domain event
- Uses in-memory Set + DB-level optimistic locking for concurrency safety

## Commission Model

- **Host fee**: 10% (1000 bps) added ON TOP of offered price
- **Cleaner commission**: 3% (300 bps) deducted FROM offered price
- **All arithmetic**: Integer-only with Math.trunc — no floating-point
- **Storage**: Cents (integers) for amounts, basis points for rates

## Domain Events

Domain events are emitted on every offer state transition via NestJS `EventEmitter2`
(`@nestjs/event-emitter`). Downstream consumers (Stripe escrow, chat, notifications,
tracking) subscribe via `@OnEvent` decorators in their own modules — no coupling to the
offers module. `EventEmitterModule.forRoot()` is registered in `OffersModule`.

Event names are dot-notated constants defined in `OFFER_EVENT_NAMES`
(`events/offer-domain-events.ts`) — never use raw strings.

| Event Name | Constant | Emit Method | Payload (beyond base) | When |
|------------|----------|-------------|-----------------------|------|
| `offer.created` | `OFFER_EVENT_NAMES.CREATED` | `emitCreated()` | `propertyId` | Offer enters DRAFT |
| `offer.published` | `OFFER_EVENT_NAMES.PUBLISHED` | `emitPublished()` | `propertyId` | DRAFT → PUBLISHED |
| `offer.activated` | `OFFER_EVENT_NAMES.ACTIVATED` | `emitActivated()` | — | PUBLISHED → ACTIVE (first delivery) |
| `offer.matched` | `OFFER_EVENT_NAMES.MATCHED` | `emitMatched()` | `cleanerId`, `matchSource` | ACTIVE → MATCHED |
| `offer.cancelled` | `OFFER_EVENT_NAMES.CANCELLED` | `emitCancelled()` | `previousState` | Any → CANCELLED |
| `offer.expired` | `OFFER_EVENT_NAMES.EXPIRED` | `emitExpired()` | `finalRadius` | Radius exhausted → EXPIRED |
| `offer.completed` | `OFFER_EVENT_NAMES.COMPLETED` | `emitCompleted()` | `cleanerId` | MATCHED → COMPLETED |

**Base payload** (all events): `offerId`, `hostId`, `timestamp`.

Every emission is logged at `debug` level. The `EventEmitter2` instance is injected into
`OfferEventEmitterService`, making the service fully unit-testable without a live bus.

### Consuming events (example)

```typescript
import { OnEvent } from '@nestjs/event-emitter';
import { OFFER_EVENT_NAMES, OfferMatchedEvent } from '../offers/events/offer-domain-events';

@OnEvent(OFFER_EVENT_NAMES.MATCHED)
handleOfferMatched(event: OfferMatchedEvent): void {
  // e.g. open Stripe escrow, create chat thread
}
```
