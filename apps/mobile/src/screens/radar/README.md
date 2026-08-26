# Radar Screens

## Purpose

The Cleaner's primary interface for discovering and interacting with available cleaning offers in real-time. Displays offers as animated pins on a full-screen Mapbox map with GPU-accelerated native layers, and provides an alternative list view. Real-time updates arrive via Centrifugo WebSocket; REST serves as the authoritative source of truth for reconciliation.

## Flow

```
Cleaner Navigator — Radar Tab
  → RadarScreen (map view with offer pins + list toggle)
  → FilterPanel (bottom sheet: service type, price, distance, date)
  → OfferPreviewSheet (bottom sheet on pin tap)
```

## Files

| File | Responsibility |
|------|---------------|
| `radar.types.ts` | TypeScript interfaces for radar offers, filters, WebSocket events, GeoJSON features, pagination, and API response types |
| `radar.constants.ts` | Animation configs, timing, layer IDs, polling intervals |
| `radar.api.ts` | HTTP client for `/offers/available` (paginated + filtered) and `/offers/available/snapshot` (full reconciliation) |
| `useRadarStore.ts` | Zustand store — offers Map, filters, sort, view mode, pagination, WebSocket handlers (idempotent), REST reconciliation, computed GeoJSON selectors |
| `useCentrifugoChannel.ts` | WebSocket hook — Centrifugo channel subscription, event parsing, exponential backoff reconnection, fallback signaling, and reconciliation trigger |
| `hooks/useAdVisibility.ts` | Entitlement hook for ad slot visibility — checks RevenueCat `ad_free` entitlement to determine if ads should be shown (free-tier users see ads, PRO users don't) |
| `hooks/useRadarReconciliation.ts` | Orchestrates reconciliation lifecycle — wires Centrifugo callbacks to Zustand store, starts REST polling fallback after 3+ WS failures, stops polling on WS recovery, enforces mutual exclusivity (max 5s overlap) |
| `components/map/mapStyles.ts` | Mapbox GL expression-based styles for offer pins (icon, color, opacity, price label), cluster circles (radius, color, count), work zone ring, and filter/source configuration |
| `components/map/OfferPinsLayer.tsx` | Native SymbolLayer + ShapeSource for offer pins with clustering, pin/cluster tap handling |
| `components/map/ClusterLayer.tsx` | CircleLayer + SymbolLayer for cluster aggregation display |

## Implemented Files

| File | Responsibility |
|------|---------------|
| `components/map/mapStyles.ts` | Mapbox GL expressions for pin styling (icon mapping, color, opacity, price labels, cluster sizing/color, work zone, filter expressions) |
| `components/map/WorkZoneCircle.tsx` | Semi-transparent circle overlay for the Cleaner's work zone radius — renders GeoJSON polygon via FillLayer (translucent interior) + LineLayer (dashed border), memoized geometry generation with equirectangular projection |
| `components/map/CleanerMarker.tsx` | Animated self-position marker for the Cleaner on the Radar map — pulsing ring animation (Reanimated 3) around a static accent-colored dot, rendered via MapboxGL.MarkerView at the Cleaner's GPS coordinates |
| `components/map/OfferPinsLayer.tsx` | Native Mapbox SymbolLayer for rendering offer pins — uses ShapeSource with clustering, data-driven styling via expressions, handles pin tap (select offer) and cluster tap (zoom expand), 60fps with 200+ pins via native symbol layers |
| `components/map/ClusterLayer.tsx` | Renders clustered offer points as circles with count badges — CircleLayer for backgrounds (size/color scale with point count), SymbolLayer for count text |
| `components/map/RadarMapView.tsx` | Main map container — composes all layers (WorkZoneCircle → OfferPinsLayer → CleanerMarker), handles dark/light style switching, camera control for cluster zoom, pin tap → selectOffer dispatch |
| `components/map/index.ts` | Barrel export for all map components and their prop types |
| `components/list/OfferCard.tsx` | Radar list item: property photo thumbnail, name, type, city, service type badge, Cleaner payout (locale-formatted), distance (km), scheduled date/time (offer timezone), urgency dot indicator, accessible labels |
| `components/list/AdSlot.tsx` | Placeholder component for sponsored ad content in the offer list — renders "Sponsored" label + placeholder area for free-tier Cleaners; visibility controlled via RevenueCat `ad_free` entitlement |
| `useLocationPermission.ts` | Location permission request (expo-location), GPS tracking with battery-aware accuracy (high fg / balanced bg), AppState transitions, open settings fallback, i18n explanation text |

## Planned Files (from spec)

| File | Responsibility |
|------|---------------|
| `RadarScreen.tsx` | Main container — map + list toggle, connection status |
| `components/list/OfferListView.tsx` | FlatList with infinite scroll + pull-refresh |
| `components/filters/FilterPanel.tsx` | Bottom sheet container |
| `components/OfferPreviewSheet.tsx` | Bottom sheet on pin tap |
| `components/EmptyState.tsx` | No offers / no matching filters |
| `components/OfflineBanner.tsx` | Connectivity indicator |
| `components/ViewToggle.tsx` | Map ↔ list segmented control |

## Dependencies

- `@rnmapbox/maps` — Mapbox native layers + clustering
- `react-native-reanimated` — Pin entrance/exit animations, spring physics
- `zustand` — Radar state management (useRadarStore)
- `centrifuge-js` — Centrifugo WebSocket client
- `expo-location` — Location permission + coordinates
- `react-native-purchases` (RevenueCat) — Entitlement checks for ad visibility
- Offers types (`../offers/offers.types.ts`) — ServiceType reused

## API Endpoints Used

| Method | Path | Description |
|--------|------|-------------|
| GET | `/offers/available` | Available offers for authenticated Cleaner (paginated, filterable) |
| GET | `/offers/available/snapshot` | Full unpaginated snapshot for WebSocket reconciliation |

## Data Flow

1. **Initial load**: Screen mount → REST `GET /offers/available` → render pins
2. **Real-time**: WebSocket `offers:cleaner:{id}` → `offer_new` (add pin) / `offer_status_changed` (remove pin)
3. **Reconnection**: On WS reconnect → REST `/snapshot` → replace all local data (REST wins)
4. **Polling fallback**: After 3+ WS failures → `useRadarReconciliation` starts 30s interval REST polling (max 5 min), stops immediately on WS recovery

## State Management

```
Zustand Store: useRadarStore (useRadarStore.ts)
├── State
│   ├── offers: Map<string, RadarOffer>
│   ├── filters: RadarFilters
│   ├── sort: SortOption
│   ├── viewMode: 'map' | 'list'
│   ├── connectionStatus: 'connected' | 'disconnected' | 'reconnecting'
│   ├── pagination: { page, totalPages, total }
│   └── selectedOfferId: string | null
├── Actions
│   ├── fetchAvailableOffers(page?) — GET /offers/available
│   ├── handleOfferNew(offer) — upsert from WebSocket (idempotent)
│   ├── handleOfferStatusChanged(offerId, state, changedAt) — remove with ordering guard
│   ├── reconcile() — full REST snapshot on reconnect
│   ├── setFilters / clearFilters / setSort
│   └── setViewMode / selectOffer / markOfferViewed
└── Derived
    └── getOffersAsGeoJSON() — FeatureCollection for Mapbox source
```

## Design System

- Dark mode: Mapbox custom dark style
- Pins: service type icon + price label (native SymbolLayer)
- Urgent offers: pulsing accent color animation
- Viewed offers: reduced opacity
- All UI text uses i18n keys (prefix: `radar.*`)
- Animations: Reanimated 3 with spring physics
