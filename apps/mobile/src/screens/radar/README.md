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

## Planned Files (from spec)

| File | Responsibility |
|------|---------------|
| `RadarScreen.tsx` | Main container — map + list toggle, connection status |
| `useRadarStore.ts` | Zustand store — offers map, filters, view mode, reconciliation |
| `useCentrifugoChannel.ts` | WebSocket connection + event handling + reconnection |
| `useLocationPermission.ts` | Permission request + fallback |
| `radar.constants.ts` | Animation configs, timing, layer IDs, polling intervals |
| `components/map/RadarMapView.tsx` | Mapbox MapView + layers + gesture handling |
| `components/map/OfferPinsLayer.tsx` | SymbolLayer + GeoJSON source for offers |
| `components/map/ClusterLayer.tsx` | Cluster circle + count badge |
| `components/map/CleanerMarker.tsx` | Pulsing animated self-position marker |
| `components/map/WorkZoneCircle.tsx` | Semi-transparent radius ring |
| `components/list/OfferListView.tsx` | FlatList with infinite scroll + pull-refresh |
| `components/list/OfferCard.tsx` | List item: photo, price, distance, badge |
| `components/list/AdSlot.tsx` | Ad placeholder for free-tier Cleaners |
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
