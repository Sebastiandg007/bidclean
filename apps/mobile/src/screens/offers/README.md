# Offers Screens

## Purpose

Offer creation, listing, and management screens for BidClean Hosts. This module provides the UI for creating cleaning service offers associated with properties, publishing them with optional favorites-first delivery, viewing offer lists filtered by state, and managing active offers (cancel, track radius expansion). Hosts interact with the full offer lifecycle (DRAFT → PUBLISHED → ACTIVE → MATCHED/COMPLETED/CANCELLED/EXPIRED) through these screens.

## Flow

```
Host Navigator — Offers Tab
  → OfferListScreen (tab-filtered: Active, Completed, Expired, Cancelled)
  → CreateOfferScreen (multi-step form: property → details → review)
  → OfferConfirmationScreen (summary + favorites toggle + publish/draft actions)
  → OfferDetailScreen (state timeline, radius progress, cancel action)
```

## Files

| File | Responsibility |
|------|---------------|
| `CreateOfferScreen.tsx` | Multi-step form: Step 1 — PropertySelector; Step 2 — ServiceTypePicker + DurationSelector + date/time pickers + price input with live PriceBreakdown; Step 3 — description + review summary |
| `OfferConfirmationScreen.tsx` | Full offer summary with price breakdown, FavoritesToggle, publish/draft actions |
| `OfferListScreen.tsx` | Tab-filtered offer list (Active, Completed, Expired, Cancelled) with infinite scroll, pull-to-refresh, FAB for create |
| `OfferDetailScreen.tsx` | Offer detail with property snapshot, price breakdown, state timeline, radius progress, cancel action |
| `useOffers.ts` | Zustand store hook + API calls for offers CRUD, pagination, real-time sync |
| `offers.types.ts` | Shared TypeScript types for offer screens (Offer, OfferState, CreateOfferDto, PriceBreakdown, route params) |
| `offers.constants.ts` | Route names, service type configs, state color mappings, validation limits |

## Components

| File | Responsibility |
|------|---------------|
| `components/PropertySelector.tsx` | Fetches offer-ready properties, displays property cards with cover photo + name + city, single selection |
| `components/ServiceTypePicker.tsx` | Visual cards for service types with icons and i18n labels, single selection |
| `components/DurationSelector.tsx` | Numeric stepper with min/max bounds, hours:minutes format display |
| `components/PriceBreakdown.tsx` | Live price breakdown showing offered price + fee + total (Host view) or price - commission + payout (Cleaner view) |
| `components/FavoritesToggle.tsx` | Switch with i18n label and info tooltip for favorites-first delivery |
| `components/OfferCard.tsx` | List item: property photo + name, service type badge, price, date, state badge with color coding |
| `components/StateTimeline.tsx` | Vertical timeline of state transitions with timestamps, current state highlighted |
| `components/RadiusProgress.tsx` | Current radius display, next expansion countdown, visual progress bar |

## Tests

| File | Coverage |
|------|----------|
| `__tests__/CreateOfferScreen.spec.tsx` | Multi-step navigation, field validation per step, form submission |
| `__tests__/OfferConfirmationScreen.spec.tsx` | Summary display, favorites toggle, publish/draft actions |
| `__tests__/OfferListScreen.spec.tsx` | Tab filtering, pagination, empty states, pull-to-refresh |
| `__tests__/OfferDetailScreen.spec.tsx` | State timeline, radius progress, cancel flow with confirmation |

## Dependencies

- `react-native-reanimated` — Step transitions, radius progress animations
- `react-native-safe-area-context` — Safe area wrapper
- `expo-router` — Navigation between offer screens
- `zustand` — Offers state management (useOffers store)
- `@react-native-community/datetimepicker` — Date and time pickers
- API service (`src/services/api.service.ts`) — Offers endpoints
- Offers API module (`services/api/src/offers/`) — Backend offer lifecycle

## API Endpoints Used

| Method | Path | Description |
|--------|------|-------------|
| POST | `/offers` | Create a new offer (DRAFT) |
| POST | `/offers/:id/publish` | Publish a DRAFT offer |
| POST | `/offers/:id/cancel` | Cancel an offer |
| GET | `/offers` | List own offers (paginated, filterable by state) |
| GET | `/offers/:id` | Get offer detail with state history |
| GET | `/offers/:id/price-breakdown` | Get role-based price breakdown |

## Navigation

Registered in `HostNavigator` as a stack within the Offers tab:
- `OfferList` — Tab root screen
- `CreateOffer` — Push from FAB
- `OfferConfirmation` — Push from CreateOffer
- `OfferDetail` — Push from OfferCard tap

## Design System

Uses the BidClean design system tokens (see `src/theme/`):
- Dark mode background, accent color for CTAs and state highlights
- Card surfaces use container background tokens
- State badges: color-coded per offer state (accent for ACTIVE, muted for terminal states)
- All UI text uses i18n keys (prefix: `offers.*`)
- Typography: project custom font
- Animations: Reanimated 3 with spring physics, shared element transitions

## State Management

```
Zustand Store: useOffersStore (useOffers.ts)
├── State
│   ├── offers: Offer[] (paginated list)
│   ├── selectedOffer: Offer | null (detail view)
│   ├── priceBreakdown: PriceBreakdown | null
│   ├── isLoading / isCreating / isPublishing / isCancelling
│   ├── error: string | null (i18n key)
│   ├── page / totalPages / hasMore (pagination)
│   └── filterState: OfferState | null
├── Actions
│   ├── createOffer(payload) — POST /offers with Idempotency-Key header (expo-crypto)
│   ├── publishOffer(offerId, favoritesFirst) — POST /offers/:id/publish
│   ├── cancelOffer(offerId) — POST /offers/:id/cancel (optimistic update + rollback)
│   ├── fetchOffers(state?, page?) — GET /offers (pagination, append on page > 1)
│   ├── fetchOfferDetail(offerId) — GET /offers/:id
│   ├── getPriceBreakdown(offerId) — GET /offers/:id/price-breakdown
│   ├── handleOfferCancelled(offerId) — real-time sync via Centrifugo
│   └── reset() — clears all state
└── Hook: useOffers() — convenience wrapper
```
