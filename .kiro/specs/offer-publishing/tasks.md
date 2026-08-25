# Implementation Plan

## Overview

Implementation tasks for the Offer Publishing feature. Covers the NestJS backend module (offer lifecycle DRAFT→PUBLISHED→ACTIVE→MATCHED/COMPLETED/CANCELLED/EXPIRED, state machine with optimistic locking, commission calculation with integer arithmetic, progressive radius expansion via BullMQ delayed jobs, tiered delivery via Centrifugo WebSocket + OneSignal push fallback, cross-module contracts for CleanerDiscoveryService and PropertyReadinessCheck, domain events for downstream integration), database migrations (offers with pricing snapshots + PostGIS radius, offer_state_transitions audit log, offer_deliveries with tier/status/channel tracking), BullMQ queues (radius expansion, tier delivery, favorites window, push notification), and React Native/Expo mobile screens (creation form with multi-step flow, confirmation with price breakdown, offer list with tab filtering, offer detail with state timeline and radius progress). Commission model: 10% Host service fee added to offered price, 3% Cleaner commission deducted from offered price — all values stored as integers (cents) with basis point rates.

## Tasks

- [x] 1. Create offers module structure in NestJS (module, controller, service, repository, types, constants, dto/, entities/, commission/, delivery/, discovery/, expansion/, notification/, contracts/, events/, state-machine/, guards/, __tests__/, README)
- [ ] 2. Create database migration for offers table (UUID PK, host_id FK RESTRICT, property_id FK RESTRICT, service_type VARCHAR(30) with CHECK, pricing columns as INTEGER cents, rate snapshot in basis points, property snapshot fields, state VARCHAR(20) with CHECK, delivery config, radius tracking, idempotency_key, timestamp columns, partial indexes for host+state, UNIQUE partial index uq_one_active_offer_per_property WHERE state IN DRAFT/PUBLISHED/ACTIVE, UNIQUE partial index uq_offers_idempotency, CHECK constraints for price positive + duration bounds + host_total formula + cleaner_payout formula)
- [ ] 3. Create database migration for offer_state_transitions table (UUID PK, offer_id FK CASCADE, from_state nullable VARCHAR(20) with CHECK, to_state VARCHAR(20) with CHECK, triggered_by VARCHAR(50), metadata JSONB, created_at, composite index on offer_id+created_at)
- [ ] 4. Create database migration for offer_deliveries table (UUID PK, offer_id FK CASCADE, cleaner_id FK SET NULL, tier VARCHAR(10) with CHECK FAVORITE/PRO/FREE, delivery_status VARCHAR(10) with CHECK PENDING/SENT/FAILED, delivery_channel VARCHAR(20) with CHECK WEBSOCKET/PUSH nullable, failure_reason TEXT, radius_step INTEGER, created_at, delivered_at, UNIQUE constraint on offer_id+cleaner_id, indexes on offer_id, cleaner_id, offer_id+delivery_status)
- [ ] 5. Add offer environment variables to .env.example (OFFER_HOST_FEE_RATE, OFFER_CLEANER_RATE, OFFER_INITIAL_RADIUS, OFFER_EXPANSION_STEP, OFFER_MAX_RADIUS, OFFER_EXPANSION_INTERVAL_MS, OFFER_FINAL_WAIT_MS, OFFER_FAVORITES_WINDOW_MS, OFFER_PRO_FREE_DELAY_MS, OFFER_MIN_LEAD_MINUTES, OFFER_MIN_DURATION_MINUTES, OFFER_MAX_DURATION_MINUTES, OFFER_MAX_RETRIES, OFFER_BACKOFF_DELAY_MS, CENTRIFUGO_API_URL, CENTRIFUGO_API_KEY, ONESIGNAL_APP_ID, ONESIGNAL_API_KEY)
- [ ] 6. Implement Offer, OfferStateTransition, and OfferDelivery TypeORM entities (Offer: all columns + constraints + JSDoc; OfferStateTransition: audit trail; OfferDelivery: tier + status + channel tracking)
- [ ] 7. Implement offers.types.ts and offers.constants.ts (OfferState enum, ServiceType enum, DeliveryTier enum, DeliveryStatus enum, DeliveryChannel enum, ALLOWED_TRANSITIONS map, OFFER_CONFIG from environment variables with defaults)
- [ ] 8. Implement offer state machine (transitionState function with optimistic locking via UPDATE WHERE state = expectedState, allowed transitions validation, audit trail insertion, returns success/failure boolean)
  - [ ] 8.1. Write property test: State Machine Transition Validity — generate random (currentState, targetState) pairs from all 7x7 combinations, assert transition succeeds iff pair is in ALLOWED_TRANSITIONS map
- [ ] 9. Implement CommissionService (calculateHostFee, calculateCleanerCommission, getFullBreakdown — all using integer-only arithmetic with Math.trunc, no floating-point, rate stored in basis points)
  - [ ] 9.1. Write property test: Host Commission Calculation Invariant — generate random positive integers 1–100_000_000, assert fee = trunc(price * rate / 10000), total = price + fee, all positive integers
  - [ ] 9.2. Write property test: Cleaner Commission Calculation Invariant — generate random positive integers 1–100_000_000, assert commission = trunc(price * rate / 10000), payout = price - commission, payout < price, all non-negative
- [ ] 10. Implement PropertyReadinessCheck contract interface and default implementation (interface: check(propertyId, hostId) → PropertyReadinessResult; validates NOT_FOUND, NOT_OWNED, DELETED, NO_PHOTOS, INVALID_LOCATION, MISSING_REQUIRED_FIELDS, HAS_ACTIVE_OFFER)
- [ ] 11. Implement CleanerDiscoveryService contract interface (interface: findEligibleCleaners(params) → DiscoveredCleaner[]; stub implementation returning empty array until cleaner-profiles module exists)
- [ ] 12. Implement OfferMatchContract interface (match method: offerId, cleanerId, matchSource → MatchResult; validates ACTIVE state before transitioning to MATCHED)
- [ ] 13. Implement OfferOwnerGuard (CanActivate guard: extracts offerId from route params, queries offer WHERE id AND host_id, throws ForbiddenException if not owner or not found)
- [ ] 14. Implement offers repository (create, findById, findByHostId with pagination + state filter + sort, updateState with optimistic locking, updateRadiusExpansion, insertStateTransition, insertDelivery, updateDeliveryStatus, findDeliveriesByOffer, findDeliveredCleanerIds — all queries scoped to ownership where applicable)
- [ ] 15. Implement domain events types and OfferEventEmitter service (OfferCreated, OfferPublished, OfferActivated, OfferMatched, OfferCancelled, OfferExpired, OfferCompleted — emit via NestJS EventEmitter2)
- [ ] 16. Implement OffersService — create offer flow (validate ownership via PropertyReadinessCheck, validate required fields, validate price positive, validate scheduled_at future with MIN_LEAD_TIME, validate duration bounds, check duplicate active offer, calculate commission breakdown, persist DRAFT with idempotency key support, emit OfferCreated event)
  - [ ] 16.1. Write property test: Price Validation — Positive Only — generate random integers -1_000_000 to 1_000_000, assert only positive values pass
  - [ ] 16.2. Write property test: Duration Bounds Validation — generate random integers 0 to 1000, assert only values in [MIN, MAX] pass
  - [ ] 16.3. Write property test: Scheduled Time Validation — generate random timestamps around now() +/- lead time, assert only future times with sufficient lead pass
  - [ ] 16.4. Write property test: Idempotency Round Trip — generate random valid payloads + random keys, assert two calls with same (hostId, key) return same offer ID
  - [ ] 16.5. Write property test: Duplicate Active Offer Prevention — generate random states for existing offers, assert only terminal states allow new creation
  - [ ] 16.6. Write property test: Required Fields Validation — generate payloads with random missing fields, assert creation rejected with validation error
- [ ] 17. Implement OffersService — publish offer flow (validate DRAFT state, snapshot property data to offer record, transition to PUBLISHED, enqueue initial-delivery job delay:0, enqueue first expansion job with delay:EXPANSION_INTERVAL_MS, set published_at, emit OfferPublished event)
- [ ] 18. Implement OffersService — cancel offer flow (validate state is DRAFT/PUBLISHED/ACTIVE, transition to CANCELLED via state machine, cancel pending BullMQ jobs, if was ACTIVE: publish cancellation to delivered Cleaners via Centrifugo personal channels, set cancelled_at, emit OfferCancelled event)
- [ ] 19. Implement CentrifugoClient (HTTP client for Centrifugo server API: publish to single channel, broadcast to multiple channels; uses CENTRIFUGO_API_URL + CENTRIFUGO_API_KEY from env; error handling with retry)
- [ ] 20. Implement DeliverySchedulerService (orchestrates tier delivery: partitions Cleaners by tier, delivers to Favorites first if enabled, schedules PRO delivery after favorites window, schedules FREE delivery after PRO delay, creates delivery records with PENDING status, attempts WebSocket then Push fallback, updates delivery status to SENT or FAILED, triggers PUBLISHED→ACTIVE on first SENT delivery)
- [ ] 21. Implement OfferNotificationService (OneSignal push notifications for offline Cleaners: sends push with offer payload, handles failure gracefully, updates delivery record channel to PUSH on success)
- [ ] 22. Implement RadiusExpansionProcessor (BullMQ worker for offer-radius-expansion queue: stale job guard validates state + step count, calls CleanerDiscoveryService with expanded radius excluding already-delivered, partitions by tier, triggers DeliverySchedulerService, updates offer radius + step count, enqueues next expansion or final-wait job, handles expiration when max radius + final wait elapsed)
  - [ ] 22.1. Write property test: Radius Expansion Monotonicity (Capped) — generate random step counts 0–20 + random configs, assert radius = min(initial + step * size, max), never exceeds max
  - [ ] 22.2. Write property test: Stale Job Idempotency — generate jobs with mismatched state or step count, assert job completes without side effects
- [ ] 23. Implement BullMQ queue registrations and job types (offer-radius-expansion, offer-tier-delivery, offer-favorites-window, offer-push-notification queues with configurable retry + exponential backoff)
- [ ] 24. Implement offers controller (POST /offers — create, POST /offers/:id/publish — publish, POST /offers/:id/cancel — cancel, GET /offers — list paginated with state filter, GET /offers/:id — detail with state history, GET /offers/:id/price-breakdown — role-based view; all with Access token + Host role + OfferOwnerGuard where applicable)
  - [ ] 24.1. Write property test: Ownership Isolation — generate random (userId, offerId) pairs where host_id != userId, assert all mutations rejected with forbidden
  - [ ] 24.2. Write property test: Offer List Filtering Correctness — generate random state filters + random offer sets, assert all returned items match filter and sorted DESC
  - [ ] 24.3. Write property test: State Transition Audit Completeness — generate random valid transitions, assert offer_state_transitions record exists with correct from_state, to_state, triggered_by, non-null created_at
- [ ] 25. Implement DTO files (CreateOfferDto with class-validator decorators, PublishOfferDto with favoritesFirst flag, OfferQueryDto with state filter + pagination, OfferResponseDto with price breakdown + state history, PriceBreakdownResponseDto for Host and Cleaner views)
- [ ] 26. Implement OffersModule registration (register all providers, controllers, BullMQ queues, imports from shared modules, exports for cross-module contracts)
  - [ ] 26.1. Write property test: State Transition Atomicity (Concurrency Safety) — simulate N concurrent transitions on same offer, assert exactly 1 succeeds and N-1 fail
- [ ] 27. Create mobile offers screens folder structure with README (screens/, components/, types, constants, hooks, __tests__/)
- [ ] 28. Implement offers.types.ts and offers.constants.ts for mobile (Offer interface, OfferState type, ServiceType type, CreateOfferDto, PriceBreakdown interface, screen route params)
- [ ] 29. Implement useOffers Zustand store (createOffer with idempotency key, publishOffer with favoritesFirst, cancelOffer, fetchOffers with pagination + filter, fetchOfferDetail, getPriceBreakdown computed, handleOfferCancelled for real-time, optimistic updates)
- [ ] 30. Implement PropertySelector component (fetches only offer-ready properties from API, displays property card with cover photo + name + city, single selection, empty state when no properties ready, links to create property)
- [ ] 31. Implement ServiceTypePicker component (visual cards for each service type: standard, deep, move_in_out, post_construction, post_event, recurring — with icon and i18n label, single selection, accent border on selected)
- [ ] 32. Implement DurationSelector component (numeric input or stepper with configurable min/max bounds from constants, shows hours:minutes format, validates on change)
- [ ] 33. Implement PriceBreakdown component (accepts priceCents + role, shows offered price + fee/commission + total/payout, formats currency with locale, updates live as price input changes)
- [ ] 34. Implement FavoritesToggle component (switch with i18n label, info tooltip explaining favorites-first delivery, disabled state when Host has no favorites)
- [ ] 35. Implement CreateOfferScreen (multi-step form: Step 1 — PropertySelector; Step 2 — ServiceTypePicker + DurationSelector + date/time pickers + price input with live PriceBreakdown; Step 3 — optional description + review summary; step indicator, per-step validation, back navigation between steps)
- [ ] 36. Implement OfferConfirmationScreen (full offer summary: property card, service details, date/time, price breakdown for Host, FavoritesToggle, "Publish Offer" CTA, "Save as Draft" secondary action, navigates back on cancel)
- [ ] 37. Implement OfferCard component (property cover photo + name, service type badge, offered price + total cost, scheduled date/time, state badge with color coding per state, tap navigates to detail)
- [ ] 38. Implement StateTimeline component (vertical timeline showing state transitions with timestamps, current state highlighted with accent color, uses state transition history from API)
- [ ] 39. Implement RadiusProgress component (current radius display in km, next expansion countdown timer, visual progress bar showing current/max radius ratio, updates in real-time while ACTIVE)
- [ ] 40. Implement OfferListScreen (tab-filtered list: Active, Completed, Expired, Cancelled; FlatList with OfferCard items, pull-to-refresh, pagination with infinite scroll, empty states per tab, FAB for "Create Offer")
- [ ] 41. Implement OfferDetailScreen (property snapshot card, service details section, full price breakdown, state timeline, radius progress if ACTIVE, cancel button if DRAFT/PUBLISHED/ACTIVE with confirmation dialog, delivery count indicator)
- [ ] 42. Create i18n translation files for offers module (en/offers.json, es/offers.json — all screen labels, form fields, service type names, state labels, error messages, validation messages, confirmation dialogs, empty states, price formatting, timer labels)
- [ ] 43. Register offers screens in HostNavigator (add Offers tab or stack screens: OfferList, CreateOffer, OfferConfirmation, OfferDetail)

## Task Dependency Graph

```json
{
  "waves": [
    [1, 2, 3, 4, 5, 27],
    [6, 7, 28, 42],
    [8, 9, 10, 11, 12, 13, 15, 29],
    [14, 19, 21, 23, 25, 30, 31, 32, 33, 34],
    [16, 20, 22, 24, 26, 35, 36, 37, 38, 39],
    [17, 18, 40, 41],
    [43]
  ]
}
```

## Notes

- The offers table uses a UNIQUE partial index (`uq_one_active_offer_per_property`) to enforce at the database level that only one offer per property can exist in DRAFT, PUBLISHED, or ACTIVE state. This is the primary defense against duplicate offers — application-level checks are secondary.
- All monetary values are stored as INTEGER (cents). Commission rates are stored as basis points (1/100th of a percent) for precision. No floating-point arithmetic is used in monetary calculations. `Math.trunc` is used for integer division.
- State transitions use optimistic locking: `UPDATE offers SET state = $new WHERE id = $id AND state = $expected`. If `affectedRows = 0`, the transition lost a race and the caller must handle the conflict. This pattern replaces traditional database locks.
- BullMQ jobs include `{ offerId, expectedState, expectedStep }` in their payload. The stale job guard validates all three before processing. If validation fails, the job completes silently (no retry, no error). This makes all jobs idempotent.
- Centrifugo is a transport layer only — PostgreSQL is the source of truth. If a Cleaner misses a WebSocket event, they reconstruct state via the REST API. Cancellations are delivered to the personal channels of Cleaners who received the offer (queried from `offer_deliveries`).
- The delivery flow: create PENDING record → attempt WebSocket via Centrifugo → on failure, attempt push via OneSignal → update status to SENT (with channel) or FAILED (with reason). The PUBLISHED → ACTIVE transition fires on the first SENT delivery.
- `PropertyReadinessCheck` is a contract interface that checks: property exists, owned by Host, not deleted, has photos, has valid location, has required fields, and has no active offer. This is the same interface defined in the property-management spec but now fully implemented with the HAS_ACTIVE_OFFER check.
- `CleanerDiscoveryService` is a contract interface combining data from cleaner_profiles (location, availability), KYC (approved), subscriptions (PRO/FREE), and favorites (host-specific). The initial implementation returns a stub until those modules exist.
- Domain events are emitted on every state transition via NestJS EventEmitter2. Future consumers (Stripe escrow on OfferMatched, chat on OfferMatched, notifications on all events) subscribe to these events without coupling to the offers module.
- The radius expansion algorithm: initial radius → expand by step every interval → cap at max radius → wait final interval → expire. Each step delivers to NEW Cleaners only (excluding already-delivered IDs from `offer_deliveries`).
- Tier delivery order: Favorites (if enabled) → wait favorites window → PRO → wait tier delay → FREE. Each tier uses the Cleaners discovered within the CURRENT radius at the time of delivery.
- The mobile app uses a single Zustand store (`useOffers`) for all offer state. Real-time updates (cancellations from other sources) are handled via Centrifugo subscription on the Cleaner's personal channel.
- ON DELETE RESTRICT on host_id and property_id prevents accidental deletion of users or properties that have offer history. ON DELETE SET NULL on cleaner_id in offer_deliveries preserves audit history when a Cleaner account is deleted.
- Property snapshot fields (name, type, city, cover_photo) are captured at publish time and stored immutably on the offer record. This ensures the offer detail remains accurate even if the property is later modified.
- The OfferMatchContract is exposed for external modules (offer-negotiation, offer-radar) to call when a match occurs. Only this contract can execute the ACTIVE → MATCHED transition.
- Property-based tests use `fast-check` with minimum 100 iterations per property. Tests are tagged with requirement references: `// Feature: offer-publishing, Property N: [title]`.
- The Host navigator already exists — task 43 registers the new offers screens into the existing navigation structure.
