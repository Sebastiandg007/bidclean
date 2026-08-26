# Offers Tests

## Purpose

Unit and integration tests for the offers screens module. Tests cover screen rendering, user interactions, form validation, navigation flows, and state management.

## Files

| File | Coverage |
|------|----------|
| `CreateOfferScreen.spec.tsx` | Multi-step navigation, field validation per step, form submission, property selection |
| `OfferConfirmationScreen.spec.tsx` | Summary display, favorites toggle, publish/draft actions, navigation |
| `OfferListScreen.spec.tsx` | Tab filtering, pagination, empty states, pull-to-refresh, FAB navigation |
| `OfferDetailScreen.spec.tsx` | State timeline rendering, radius progress, cancel flow with confirmation dialog |

## Testing Conventions

- Uses React Native Testing Library
- Tests are co-located with sources via `__tests__/` folder
- Test names follow: `should [expected behavior] when [condition]`
- Arrange → Act → Assert pattern
- No shared mutable state between tests
