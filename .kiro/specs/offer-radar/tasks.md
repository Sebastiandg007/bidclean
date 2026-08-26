# Implementation Plan: Offer Radar

## Overview

The Offer Radar is the Cleaner's primary interface for discovering cleaning offers in real-time. Implementation follows a bottom-up approach: backend endpoint first (source of truth), then mobile state management (Zustand + WebSocket), then UI components (map, list, filters, bottom sheet), and finally integration wiring. The backend reads from existing tables (offers, offer_deliveries, cleaner_profiles) with no new schema creation — only a spatial index addition. The mobile app uses native Mapbox symbol layers for 60fps rendering at 200+ pins, Centrifugo WebSocket for real-time delivery, and a clear reconciliation strategy where REST always wins.

## Tasks

- [x] 1. Backend — Available Offers Endpoint (REST)
  - [x] 1.1 Create DTO classes for available offers query parameters and response
    - Create `available-offers-query.dto.ts` with class-validator decorators for: `serviceType` (optional string array), `minPriceCents` (optional integer), `maxPriceCents` (optional integer), `maxDistanceMeters` (optional integer), `scheduledBefore` (optional ISO 8601), `scheduledAfter` (optional ISO 8601), `sort` (enum: distance_asc, price_desc, scheduled_asc, published_desc, default: distance_asc), `page` (integer, default: 1), `limit` (integer, default: 20, max: 50)
    - Create `available-offer-response.dto.ts` with the `AvailableOffer` interface and `AvailableOffersResponse` paginated wrapper
    - Create `available-offers.types.ts` with internal types used by service/repository
    - Directory: `services/api/src/offers/available/dto/`
    - _Requirements: 4.1, 4.3, 4.4, 4.7_

  - [x] 1.2 Implement available offers repository with PostGIS query
    - Create `available-offers.repository.ts` with raw SQL query joining `offers` + `offer_deliveries` + `cleaner_profiles`
    - Implement PostGIS `ST_Distance` for distance calculation from Cleaner's work zone center
    - Implement `ST_DWithin` for `maxDistanceMeters` filter (presentation-only, not eligibility)
    - Implement dynamic WHERE clause building: each filter is applied only when the parameter is provided
    - Implement sort CASE expressions for all 4 sort options
    - Implement pagination with LIMIT/OFFSET
    - Visibility contract: `o.state = 'ACTIVE' AND od.delivery_status = 'SENT' AND od.cleaner_id = :cleanerId AND o.scheduled_at > NOW()`
    - Implement snapshot query (same WHERE, no pagination, returns all matching offers)
    - Directory: `services/api/src/offers/available/`
    - _Requirements: 4.1, 4.2, 4.3, 4.7, 4.8, 4.9_

  - [x] 1.3 Implement available offers service (business logic layer)
    - Create `available-offers.service.ts` that orchestrates repository calls
    - Extract authenticated Cleaner ID from request context
    - Map raw DB results to `AvailableOffer` response shape (propertySnapshot, priceBreakdown, publicLocation)
    - Compute `isUrgent` as `scheduled_at <= NOW() + 2 hours`
    - Ensure no private fields (street, postal code, exact coordinates) leak into response
    - Implement rate limiting logic for snapshot endpoint (max 1 req/30s per Cleaner)
    - _Requirements: 4.4, 4.5, 4.6, 4.8_

  - [x] 1.4 Implement available offers controller with auth guard
    - Create `available-offers.controller.ts` with two endpoints:
      - `GET /offers/available` — paginated, filtered, sorted
      - `GET /offers/available/snapshot` — full unpaginated set for reconciliation
    - Apply JWT auth guard (Keycloak) and Cleaner role guard
    - Wire DTO validation pipe for query parameters
    - Return proper HTTP status codes (200, 401, 403, 429)
    - Add Swagger/OpenAPI decorators for documentation
    - _Requirements: 4.1, 4.2, 4.5_

  - [ ]* 1.5 Write unit tests for available offers service
    - Test filter application (each filter independently and all combined)
    - Test sort ordering for all 4 sort options
    - Test pagination math (page/limit/total/totalPages)
    - Test urgency calculation (offers within 2 hours vs. beyond)
    - Test privacy: no forbidden fields in response (address_street, address_postal_code, etc.)
    - Test visibility contract: only ACTIVE + SENT + not-expired offers returned
    - _Requirements: 4.1, 4.3, 4.5, 4.8_

  - [ ]* 1.6 Write unit tests for available offers repository
    - Test SQL query builder for each filter parameter
    - Test null-filter handling (parameter not provided → no WHERE clause)
    - Test sort clause generation for each option
    - Test pagination offset calculation
    - _Requirements: 4.2, 4.3, 4.7_

  - [ ]* 1.7 Write unit tests for available offers controller
    - Test auth guard rejects unauthenticated requests
    - Test role guard rejects non-Cleaner roles
    - Test DTO validation rejects invalid parameters (negative prices, invalid sort values)
    - Test response shape matches documented interface
    - _Requirements: 4.1_

- [~] 2. Checkpoint — Backend endpoint tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Mobile — Zustand Store (useRadarStore)
  - [x] 3.1 Create radar types and constants
    - Create `radar.types.ts` with all TypeScript interfaces: `RadarOffer`, `RadarFilters`, `ViewMode`, `SortOption`, `ConnectionStatus`, `OfferFeature` (GeoJSON)
    - Create `radar.constants.ts` with all configurable values from env: `RADAR_POLLING_INTERVAL_MS`, `RADAR_MAX_POLLING_DURATION_MS`, `URGENCY_REFRESH_INTERVAL_MS`, `WS_MAX_BACKOFF_MS`, `WS_FALLBACK_THRESHOLD`, animation configs, layer IDs
    - Directory: `apps/mobile/src/screens/radar/`
    - _Requirements: 12.1, 12.2_

  - [x] 3.2 Implement useRadarStore with Zustand
    - Create `useRadarStore.ts` with full store interface from design
    - State: `offers` (Map<string, RadarOffer>), `offerEventTimestamps` (Map<string, string>), `filters`, `sort`, `viewMode`, `connectionStatus`, `isLoading`, `isRefreshing`, `pagination`, `selectedOfferId`, `lastSuccessfulSyncAt`, `lastWebSocketEventAt`
    - REST actions: `fetchAvailableOffers` (paginated), `refreshOffers` (page 1 re-fetch), `loadMoreOffers` (next page append)
    - WebSocket event handlers (IDEMPOTENT): `handleOfferNew` (upsert — insert if new, update if exists), `handleOfferStatusChanged` (only apply if changedAt > existing timestamp)
    - Reconciliation action: `reconcile` — calls /snapshot, replaces all local offers with server response
    - Filter actions: `setFilters`, `clearFilters`, `setSort`
    - UI actions: `setViewMode`, `selectOffer`, `markOfferViewed`, `setConnectionStatus`, `markAllStale`
    - Computed selectors: `getOffersAsGeoJSON()`, `getOffersList()`, `getActiveFilterCount()`
    - _Requirements: 3.2, 3.3, 5.3, 5.4, 14.1, 14.2, 14.3_

  - [ ]* 3.3 Write unit tests for useRadarStore
    - Test `handleOfferNew` idempotency (same offerId multiple times → one entry)
    - Test `handleOfferStatusChanged` temporal ordering (older event after newer → discarded)
    - Test `reconcile` replaces all local state with snapshot
    - Test `setFilters` triggers re-fetch
    - Test `clearFilters` resets all filters and re-fetches
    - Test `getOffersAsGeoJSON` transformation correctness
    - Test `markAllStale` sets isStale=true on all offers
    - _Requirements: 3.2, 3.3, 14.3, 14.4_

- [x] 4. Mobile — Centrifugo WebSocket Hook
  - [x] 4.1 Implement useCentrifugoChannel hook
    - Create `useCentrifugoChannel.ts` with subscription to `offers:cleaner:{cleanerId}`
    - Parse incoming events: `offer_new` → dispatch to store `handleOfferNew`, `offer_status_changed` → dispatch to store `handleOfferStatusChanged`
    - Implement exponential backoff reconnection: 1s, 2s, 4s, 8s, 16s, 30s (capped at WS_MAX_BACKOFF_MS)
    - After 3 failed reconnection attempts: emit fallback signal for periodic REST polling
    - On successful reconnect: trigger full reconciliation via REST /snapshot endpoint
    - Track connection status transitions: connected → disconnected → reconnecting → connected
    - Ensure mutual exclusivity: WebSocket and polling never run simultaneously (max 5s overlap window)
    - Subscribe on mount, unsubscribe on unmount (cleanup)
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 13.6_

  - [ ]* 4.2 Write unit tests for useCentrifugoChannel
    - Test event parsing for offer_new and offer_status_changed
    - Test reconnection attempt counter increments correctly
    - Test connection status transitions (connected → disconnected → reconnecting)
    - Test fallback signal emitted after 3 failures
    - Test reconciliation triggered on reconnect
    - Test cleanup on unmount (unsubscribe called)
    - _Requirements: 3.1, 3.5, 3.6, 13.6_

- [x] 5. Mobile — Reconciliation & Polling Fallback
  - [x] 5.1 Implement useRadarReconciliation hook
    - Create `hooks/useRadarReconciliation.ts` that manages the reconciliation lifecycle
    - On WebSocket reconnect: call store.reconcile() which fetches /snapshot
    - Implement polling fallback: when WS fails 3+ times, start 30s interval REST polling
    - Polling max duration: 5 minutes (RADAR_MAX_POLLING_DURATION_MS), then show permanent "reconnecting" state
    - Stop polling immediately when WebSocket recovers
    - Ensure no simultaneous WS + polling (controlled 5s overlap window for reconciliation)
    - _Requirements: 3.6, 13.4, 13.6, 14.3_

- [~] 6. Checkpoint — Store and WebSocket logic complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Mobile — Map Components
  - [x] 7.1 Implement RadarMapView (main map container)
    - Create `components/map/RadarMapView.tsx` with Mapbox MapView using BidClean dark custom style
    - Configure map: initial center on Cleaner GPS, support all standard gestures (pinch-to-zoom, pan, rotate, double-tap)
    - Render layers in correct order: base map → WorkZoneCircle → OfferPinsLayer → ClusterLayer → CleanerMarker
    - Handle map style switching (dark/light) based on user theme preference
    - Wire pin tap handler → open OfferPreviewSheet (via `selectOffer` in store)
    - Wire cluster tap handler → zoom to expand (flyTo with zoom + 2)
    - _Requirements: 1.1, 1.2, 1.5, 1.7, 1.8_

  - [x] 7.2 Implement OfferPinsLayer with native Mapbox SymbolLayer
    - Create `components/map/OfferPinsLayer.tsx` using `ShapeSource` + `SymbolLayer` (NOT React Native Markers)
    - GeoJSON source derived reactively from store `getOffersAsGeoJSON()`
    - Configure clustering: `clusterRadius: 50`, `clusterMaxZoom: 14`
    - Pin icon: mapped from `serviceType` property to icon asset name (Mapbox expressions)
    - Pin color: urgent = pulsing accent (#00F5D4), normal = white, viewed = reduced opacity (0.6)
    - Pin label: formatted payout price (currency + amount)
    - Pin stale state: reduced opacity (0.5) for offline-cached offers
    - _Requirements: 1.6, 2.1, 2.3, 2.4, 2.5, 2.8, 12.3_

  - [x] 7.3 Implement ClusterLayer
    - Create `components/map/ClusterLayer.tsx` for cluster circle rendering
    - Show cluster count badge inside circle
    - Size circles proportionally to cluster point count
    - Track urgent count in cluster properties (`urgentCount` aggregation)
    - _Requirements: 1.6, 1.7_

  - [x] 7.4 Implement CleanerMarker (animated self-position)
    - Create `components/map/CleanerMarker.tsx` with pulsing ring animation (Reanimated 3)
    - Position updates from GPS (significant-change when backgrounded, high-accuracy when foregrounded)
    - Distinct visual styling from offer pins
    - _Requirements: 1.3, 9.4_

  - [x] 7.5 Implement WorkZoneCircle
    - Create `components/map/WorkZoneCircle.tsx` with semi-transparent fill + border
    - Radius from `cleaner_profiles.work_radius_meters`
    - Center on Cleaner's configured work zone center (NOT GPS)
    - _Requirements: 1.4, 10.1_

  - [x] 7.6 Implement map styles configuration
    - Create `components/map/mapStyles.ts` with Mapbox expressions for pin styling
    - Define icon image mapping (serviceType → asset name)
    - Define color expressions (urgency, viewed state, stale state)
    - Define text formatting for price labels
    - Define cluster styling expressions
    - _Requirements: 2.3, 2.4, 2.5_

- [ ] 8. Mobile — Pin Animations
  - [~] 8.1 Implement useOfferAnimations hook
    - Create `hooks/useOfferAnimations.ts` with Reanimated 3 spring configs
    - Entrance animation: spring drop + bounce effect for new pins (within 300ms of event)
    - Exit animation: fade + scale down for removed pins (CANCELLED/EXPIRED/MATCHED)
    - Urgency pulse: glowing/pulsing effect for offers scheduled within 2 hours
    - Optional haptic feedback on new pin appearance (configurable)
    - _Requirements: 2.2, 2.5, 2.6, 2.7, 12.2_

- [ ] 9. Mobile — List View
  - [x] 9.1 Implement OfferCard component
    - Create `components/list/OfferCard.tsx` with: property cover photo thumbnail, property name, property type, service type badge, price (Cleaner payout formatted by locale), distance (km or miles by locale), scheduled date/time (converted to offer timezone), urgency indicator
    - Tap handler navigates to Offer Detail screen
    - Accessible labels for screen readers (price + service type + distance)
    - _Requirements: 6.3, 6.6_

  - [x] 9.2 Implement AdSlot component
    - Create `components/list/AdSlot.tsx` placeholder for ad content
    - Implement `hooks/useAdVisibility.ts` — check RevenueCat entitlement for `adsEnabled` flag
    - Ad visibility controlled by abstracted entitlement layer (not by checking `cleaner_pro` directly)
    - _Requirements: 6.7_

  - [~] 9.3 Implement OfferListView with infinite scroll and ads
    - Create `components/list/OfferListView.tsx` with FlatList
    - Sorted by selected sort option (default: distance_asc)
    - Pull-to-refresh triggers `refreshOffers()`
    - Infinite scroll: `onEndReached` triggers `loadMoreOffers()`
    - Ad slot injection: every 5th position (0-indexed: 4, 9, 14, 19...) when `adsEnabled = true`
    - Skeleton loaders during initial fetch (never generic spinner)
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.7, 12.5_

  - [ ]* 9.4 Write unit tests for OfferListView
    - Test ad slot positioning (every 5th position when enabled, none when disabled)
    - Test pull-to-refresh triggers re-fetch
    - Test infinite scroll triggers load more
    - Test sort option reflected in list order
    - _Requirements: 6.2, 6.4, 6.5, 6.7_

- [x] 10. Mobile — Filter Panel
  - [x] 10.1 Implement FilterPanel container
    - Create `components/filters/FilterPanel.tsx` as a bottom sheet
    - Contains all filter sub-components
    - "Clear all" button resets all filters via store `clearFilters()`
    - Active filter count badge on filter button (from store `getActiveFilterCount()`)
    - Filter changes trigger server-side re-fetch with new query params
    - _Requirements: 5.1, 5.2, 5.3, 5.5_

  - [x] 10.2 Implement ServiceTypeChips
    - Create `components/filters/ServiceTypeChips.tsx` with multi-select chip UI
    - Service types: standard, deep, move_in_out, post_construction, post_event, recurring
    - All i18n keys for labels (no hardcoded text)
    - _Requirements: 5.1_

  - [x] 10.3 Implement PriceRangeSlider
    - Create `components/filters/PriceRangeSlider.tsx` with dual-thumb slider
    - Min/max range in local currency display (formatted by locale)
    - Updates store `setFilters({ minPriceCents, maxPriceCents })`
    - _Requirements: 5.1_

  - [x] 10.4 Implement DistanceSlider
    - Create `components/filters/DistanceSlider.tsx` with single-thumb slider
    - Display in km (metric) or miles (US/UK) based on user locale
    - Updates store `setFilters({ maxDistanceMeters })`
    - _Requirements: 5.1_

  - [x] 10.5 Implement DateRangeFilter
    - Create `components/filters/DateRangeFilter.tsx` with quick picks (today, tomorrow, this week) + custom date picker
    - Updates store `setFilters({ scheduledAfter, scheduledBefore })`
    - _Requirements: 5.1_

  - [ ]* 10.6 Write unit tests for FilterPanel
    - Test filter state persistence during session
    - Test clear all resets all values
    - Test badge count reflects active filters
    - Test filter changes trigger API re-fetch with correct params
    - _Requirements: 5.2, 5.3, 5.4, 5.5_

- [ ] 11. Mobile — Bottom Sheet Preview
  - [~] 11.1 Implement OfferPreviewSheet
    - Create `components/OfferPreviewSheet.tsx` as a bottom sheet triggered by pin tap
    - Display: property name, type, city, cover photo, service type, scheduled date/time, duration, Cleaner payout, distance
    - "View Full Details" button → navigate to full Offer Detail screen
    - "Quick Accept" button → delegate to `offer-negotiation` module (disabled when offline)
    - Swipe down to dismiss, return focus to map
    - Mark offer as viewed on open (`markOfferViewed`)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ]* 11.2 Write unit tests for OfferPreviewSheet
    - Test Quick Accept disabled when `connectionStatus = 'disconnected'`
    - Test offer data displayed correctly
    - Test dismiss on swipe down
    - Test markOfferViewed called on open
    - _Requirements: 7.4, 7.5, 7.6_

- [ ] 12. Mobile — Empty States, Offline Banner, Connectivity, View Toggle
  - [~] 12.1 Implement EmptyState component
    - Create `components/EmptyState.tsx` with two variants:
      - No offers available: friendly illustration + "Expand your work zone" CTA → navigate to settings
      - All filtered out: "No offers match your filters" message + "Clear filters" CTA
    - All text via i18n keys
    - _Requirements: 8.1, 8.2, 8.3_

  - [~] 12.2 Implement OfflineBanner and ConnectivityIndicator
    - Create `components/OfflineBanner.tsx` — banner when device offline: "Offline — data may be outdated"
    - Create `components/ConnectivityIndicator.tsx` — subtle dot/badge for WebSocket status
    - Show "Live updates paused" when in polling fallback mode
    - _Requirements: 3.5, 13.1, 13.6_

  - [~] 12.3 Implement ViewToggle (map ↔ list)
    - Create `components/ViewToggle.tsx` — segmented control toggling `viewMode` in store
    - _Requirements: 6.1_

- [x] 13. Mobile — Location Permission Handling
  - [x] 13.1 Implement useLocationPermission hook
    - Create `useLocationPermission.ts` with permission request flow
    - Clear i18n explanation text for why location is needed
    - Fallback state when denied: full-screen explanation + "Open Settings" button
    - GPS used ONLY for: map centering, distance display, position marker (NOT offer eligibility)
    - Battery optimization: significant-change monitoring when backgrounded, high-accuracy when foregrounded
    - Cleaner GPS NOT persisted by backend (memory only for display)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ] 14. Mobile — Urgency Derivation
  - [~] 14.1 Implement client-side urgency timer
    - Add 60-second interval timer in RadarScreen that recalculates `isUrgent` for all offers
    - `isUrgent = (scheduledAt - now) <= 2 hours`
    - REST `isUrgent` field used as initial seed only
    - Offers transition from non-urgent to urgent purely through time (no event needed)
    - Update store offers Map with refreshed urgency values
    - _Requirements: 2.5, Design: Urgency Derivation section_

- [ ] 15. Mobile — RadarScreen Main Container
  - [~] 15.1 Assemble RadarScreen with all components
    - Create `RadarScreen.tsx` as the main container
    - Wire all sub-components: RadarMapView (or OfferListView based on viewMode), FilterPanel, OfferPreviewSheet, EmptyState, OfflineBanner, ConnectivityIndicator, ViewToggle
    - On mount: request location permission → fetch available offers → subscribe WebSocket
    - On unmount: unsubscribe WebSocket, cleanup timers
    - Pre-load offer data in Zustand so Offer Detail navigation is instant
    - Skeleton loaders during initial data fetch
    - Wire urgency timer (60s interval)
    - _Requirements: 1.2, 3.1, 12.5, 12.6_

  - [ ]* 15.2 Write component tests for RadarScreen
    - Test initial load → pins appear on map
    - Test WebSocket event → pin added/removed
    - Test offline state → banner shown, Quick Accept disabled
    - Test empty state shown when no offers
    - Test filter change triggers re-fetch
    - _Requirements: 3.2, 3.3, 8.1, 13.1_

- [~] 16. Checkpoint — Full UI integration working
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 17. Property-Based Tests (fast-check)
  - [ ]* 17.1 Property test: Visibility Contract Enforcement
    - **Property 1: Visibility Contract Enforcement**
    - **Validates: Requirements 4.1, 4.8, 3.7**
    - Generate random offers with all states × delivery statuses × (expired/not expired)
    - Assert only ACTIVE + SENT + not-expired offers appear in results

  - [ ]* 17.2 Property test: Filter Predicate Satisfaction
    - **Property 2: Filter Predicate Satisfaction**
    - **Validates: Requirements 4.3, 5.3**
    - Generate random offers + random valid filter combinations
    - Assert every returned offer satisfies ALL active filter predicates simultaneously

  - [ ]* 17.3 Property test: Sort Ordering Guarantee
    - **Property 3: Sort Ordering Guarantee**
    - **Validates: Requirements 4.2, 4.7**
    - Generate random offer sets + each sort option
    - Assert consecutive pair invariant holds for selected comparator

  - [ ]* 17.4 Property test: Privacy Field Exclusion
    - **Property 4: Privacy Field Exclusion**
    - **Validates: Requirements 4.5, 4.6**
    - Generate random valid query results
    - Assert no response object contains forbidden fields (street, postal code, formatted address, access instructions, location source)

  - [ ]* 17.5 Property test: Reconciliation Completeness (REST Wins)
    - **Property 5: Reconciliation Completeness**
    - **Validates: Requirements 14.3, 14.4, 3.6**
    - Generate random pre-reconciliation store state + random snapshot response
    - Assert post-reconciliation store === snapshot (exact set equality)

  - [ ]* 17.6 Property test: Ad Slot Positioning
    - **Property 6: Ad Slot Positioning**
    - **Validates: Requirements 6.7**
    - Generate random list lengths (0–200) + random adsEnabled boolean
    - Assert ad slots at positions 4,9,14,19... when enabled; none when disabled

  - [ ]* 17.7 Property test: WebSocket Event Idempotency
    - **Property 7: WebSocket Event Idempotency**
    - **Validates: Requirements 3.2, 14.2**
    - Generate random sequences of offer_new events with duplicate offerIds
    - Assert store contains exactly one entry per unique offerId

  - [ ]* 17.8 Property test: Event Temporal Ordering
    - **Property 8: Event Temporal Ordering**
    - **Validates: Requirements 3.3, 14.4**
    - Generate random pairs of status events with varying timestamps in random order
    - Assert only event with latest changedAt takes effect

  - [ ]* 17.9 Property test: Pagination Uniqueness
    - **Property 9: Pagination Uniqueness**
    - **Validates: Requirements 4.2, 6.5**
    - Generate random offer sets across multiple pages
    - Assert union of all pages contains no duplicate offerIds

  - [ ]* 17.10 Property test: Public Location Privacy Displacement
    - **Property 10: Public Location Privacy Displacement**
    - **Validates: Requirements 4.5, 4.6**
    - Generate random exact locations + random offerIds
    - Assert distance between exact and public is in [MIN_JITTER, MAX_JITTER], deterministic

  - [ ]* 17.11 Property test: Offline Acceptance Safety
    - **Property 11: Offline Acceptance Safety**
    - **Validates: Requirements 7.5, 13.3**
    - Generate random connectivity states + random user interactions
    - Assert Quick Accept is non-executable when disconnected

- [ ] 18. Integration Tests
  - [ ]* 18.1 Write integration test: full radar flow
    - Authenticate as Cleaner → fetch available offers → verify response shape and visibility rules
    - Verify only offers with `delivery_status = 'SENT'` and `state = 'ACTIVE'` appear
    - _Requirements: 4.1, 4.8_

  - [ ]* 18.2 Write integration test: filter combinations
    - Apply serviceType + price + distance filters simultaneously
    - Verify all returned offers match ALL active filters
    - _Requirements: 4.3, 5.3_

  - [ ]* 18.3 Write integration test: sort verification
    - Each sort option → verify ordering invariant in response
    - _Requirements: 4.7_

  - [ ]* 18.4 Write integration test: pagination uniqueness
    - Fetch all pages → verify no duplicates and total count matches
    - _Requirements: 4.2, 6.5_

  - [ ]* 18.5 Write integration test: distance calculation
    - Use known coordinates → verify PostGIS distance within acceptable tolerance
    - _Requirements: 4.4_

- [~] 19. Final Checkpoint — All tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- No new database tables are created — radar reads from existing `offers`, `offer_deliveries`, `cleaner_profiles`
- The `public_location` column on `offers` is populated by offer-publishing (radar only reads it)
- All map rendering uses native Mapbox symbol layers (never React Native Marker components)
- Server-side filtering: all filter parameters sent as query params to REST endpoint
- `maxDistanceMeters` is a presentation-only filter — it does NOT affect offer delivery eligibility
- Reconciliation uses `/offers/available/snapshot` (unpaginated, full set, rate-limited)
- Event ordering enforced via `changedAt` timestamps (latest wins)
- `handleOfferNew` is idempotent (upsert pattern)
- Urgency is derived client-side with a 60s timer (`scheduledAt - now <= 2h`)
- Polling fallback: 30s interval after 3 WS failures, max 5 min duration, stop on WS recovery
- All UI text uses i18n keys (no hardcoded strings)
- All configurable values from environment variables or constants files

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "3.2"] },
    { "id": 2, "tasks": ["1.3", "1.5", "3.3", "4.1"] },
    { "id": 3, "tasks": ["1.4", "1.6", "4.2", "5.1"] },
    { "id": 4, "tasks": ["1.7", "7.6", "9.1", "9.2", "13.1"] },
    { "id": 5, "tasks": ["7.1", "7.2", "7.3", "7.4", "7.5", "10.1", "10.2", "10.3", "10.4", "10.5"] },
    { "id": 6, "tasks": ["8.1", "9.3", "11.1", "12.1", "12.2", "12.3", "14.1"] },
    { "id": 7, "tasks": ["9.4", "10.6", "11.2", "15.1"] },
    { "id": 8, "tasks": ["15.2"] },
    { "id": 9, "tasks": ["17.1", "17.2", "17.3", "17.4", "17.5", "17.6", "17.7", "17.8", "17.9", "17.10", "17.11"] },
    { "id": 10, "tasks": ["18.1", "18.2", "18.3", "18.4", "18.5"] }
  ]
}
```
