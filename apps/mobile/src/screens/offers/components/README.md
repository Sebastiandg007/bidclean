# Offers Components

## Purpose

Reusable UI components for the offers screens module. Each component encapsulates a specific piece of offer-related UI and can be composed into different screens.

## Files

| File | Responsibility | Status |
|------|---------------|--------|
| `PropertySelector.tsx` | Fetches offer-ready properties, displays property cards with cover photo + name + city, single selection, empty state when no properties ready | Planned |
| `ServiceTypePicker.tsx` | Visual cards for each service type (standard, deep, move_in_out, post_construction, post_event, recurring) with icon and i18n label, single selection, accent border on selected | ✅ Implemented |
| `DurationSelector.tsx` | Numeric stepper with configurable min/max bounds, displays hours:minutes format, validates on change | Planned |
| `PriceBreakdown.tsx` | Accepts priceCents + role, shows offered price + fee/commission + total/payout, formats currency with locale, updates live | Planned |
| `FavoritesToggle.tsx` | Switch with i18n label, info tooltip explaining favorites-first delivery, disabled state when Host has no favorites | Planned |
| `OfferCard.tsx` | List item: property cover photo + name, service type badge, offered price + total cost, scheduled date/time, state badge with color coding | Planned |
| `StateTimeline.tsx` | Vertical timeline showing state transitions with timestamps, current state highlighted with accent color | Planned |
| `RadiusProgress.tsx` | Current radius in km, next expansion countdown timer, visual progress bar (current/max ratio), real-time updates while ACTIVE | Planned |

## Dependencies

- Parent screens in `screens/offers/`
- Design tokens from `offers.constants.ts` (COLORS, SPACING, FONT_SIZE)
- Types from `offers.types.ts` (ServiceType, OfferState)
- i18n keys with prefix `offers.*`
