# Offers Components

## Purpose

Reusable UI components for the offers screens module. Each component encapsulates a specific piece of offer-related UI and can be composed into different screens.

## Files

| File | Responsibility |
|------|---------------|
| `PropertySelector.tsx` | Fetches offer-ready properties, displays property cards with cover photo + name + city, single selection, empty state when no properties ready |
| `ServiceTypePicker.tsx` | Visual cards for each service type (standard, deep, move_in_out, post_construction, post_event, recurring) with icon and i18n label, single selection |
| `DurationSelector.tsx` | Numeric stepper with configurable min/max bounds, displays hours:minutes format, validates on change |
| `PriceBreakdown.tsx` | Accepts priceCents + role, shows offered price + fee/commission + total/payout, formats currency with locale, updates live |
| `FavoritesToggle.tsx` | Switch with i18n label, info tooltip explaining favorites-first delivery, disabled state when Host has no favorites |
| `OfferCard.tsx` | List item: property cover photo + name, service type badge, offered price + total cost, scheduled date/time, state badge with color coding |
| `StateTimeline.tsx` | Vertical timeline showing state transitions with timestamps, current state highlighted with accent color |
| `RadiusProgress.tsx` | Current radius in km, next expansion countdown timer, visual progress bar (current/max ratio), real-time updates while ACTIVE |

## Dependencies

- Parent screens in `screens/offers/`
- Design system tokens from `src/theme/`
- i18n keys with prefix `offers.*`
