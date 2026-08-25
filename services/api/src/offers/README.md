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
| `delivery/delivery.types.ts` | Delivery-specific types |
| `delivery/centrifugo.client.ts` | Centrifugo HTTP API client for real-time WebSocket delivery |
| `discovery/cleaner-discovery.interface.ts` | Contract interface for Cleaner geospatial discovery |
| `discovery/cleaner-discovery.service.ts` | Stub implementation (returns empty until cleaner module exists) |
| `discovery/cleaner-discovery.types.ts` | Discovery parameter and result types |
| `expansion/radius-expansion.processor.ts` | BullMQ worker for progressive radius expansion |
| `expansion/radius-expansion.types.ts` | Job payload and result types for expansion |
| `expansion/stale-job.guard.ts` | Utility to detect and skip stale BullMQ jobs |
| `notification/offer-notification.service.ts` | Push notification fallback for offline Cleaners |
| `notification/onesignal.client.ts` | OneSignal REST API client |
| `contracts/property-readiness.interface.ts` | Cross-module contract for property readiness checks |
| `contracts/offer-match.interface.ts` | Cross-module contract for offer matching (ACTIVE → MATCHED) |
| `events/offer-domain-events.ts` | Domain event type definitions |
| `events/offer-event-emitter.service.ts` | EventEmitter2-based domain event emission |
| `state-machine/offer-state-machine.ts` | Pure state transition validation function |
| `state-machine/offer-state-machine.spec.ts` | Unit tests for state machine |
| `dto/create-offer.dto.ts` | Create offer request validation |
| `dto/publish-offer.dto.ts` | Publish offer request validation |
| `dto/offer-query.dto.ts` | Query/pagination parameters |
| `dto/offer-response.dto.ts` | Response shapes including price breakdown |
| `entities/offer.entity.ts` | TypeORM entity for offers table |
| `entities/offer-state-transition.entity.ts` | TypeORM entity for audit trail |
| `entities/offer-delivery.entity.ts` | TypeORM entity for delivery tracking |
| `guards/offer-owner.guard.ts` | NestJS guard enforcing offer ownership |

## Database

### Tables
| Table | Migration | Description |
|-------|-----------|-------------|
| `offers` | `1700000010000-CreateOffersTable` | Core offers table with pricing (cents), state machine, property snapshots, radius tracking, idempotency |
| `offer_state_transitions` | `1700000011000-CreateOfferStateTransitionsTable` | Audit log tracking every lifecycle state change (from_state → to_state, triggered_by, metadata JSONB) |

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
| `OFFER_FINAL_WAIT_MS` | Final wait before expiration in ms (default: 900000) | No |
| `OFFER_FAVORITES_WINDOW_MS` | Favorites-first window in ms (default: 120000) | No |
| `OFFER_PRO_FREE_DELAY_MS` | Delay between PRO and FREE delivery in ms (default: 60000) | No |
| `OFFER_MIN_LEAD_MINUTES` | Minimum lead time for scheduling (default: 60) | No |
| `OFFER_MIN_DURATION_MINUTES` | Minimum offer duration (default: 60) | No |
| `OFFER_MAX_DURATION_MINUTES` | Maximum offer duration (default: 480) | No |
| `OFFER_MAX_RETRIES` | Max BullMQ job retries (default: 3) | No |
| `OFFER_BACKOFF_DELAY_MS` | Backoff delay for retries in ms (default: 5000) | No |
| `CENTRIFUGO_API_URL` | Centrifugo server API base URL | Yes |
| `CENTRIFUGO_API_KEY` | Centrifugo API authorization key | Yes |
| `ONESIGNAL_APP_ID` | OneSignal application identifier | Yes |
| `ONESIGNAL_API_KEY` | OneSignal REST API key | Yes |

## State Machine

```
DRAFT → PUBLISHED → ACTIVE → MATCHED → COMPLETED
  ↓         ↓          ↓
CANCELLED  CANCELLED  CANCELLED
            ↓          ↓
          EXPIRED    EXPIRED
```

## Commission Model

- **Host fee**: 10% (1000 bps) added ON TOP of offered price
- **Cleaner commission**: 3% (300 bps) deducted FROM offered price
- **All arithmetic**: Integer-only with Math.trunc — no floating-point
- **Storage**: Cents (integers) for amounts, basis points for rates
