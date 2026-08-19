# Roles Screens

## Purpose

Role selection and onboarding screens for BidClean. After email verification, users choose their role (Host, Cleaner, or both) and complete role-specific onboarding before accessing the main app experience.

## Files

| File | Responsibility |
|------|---------------|
| `RoleSelectionScreen.tsx` | Two-card role picker with single/dual selection and animated feedback |
| `HostOnboardingScreen.tsx` | Host onboarding flow: name confirmation (step 1) + payment method (step 2) |
| `CleanerOnboardingScreen.tsx` | Cleaner onboarding flow: KYC trigger (step 1) + work zone (step 2) + availability (step 3) + specialties (step 4, optional) |
| `RoleSwitchButton.tsx` | Role switch button shown in Profile tab — allows users with both roles to switch instantly |
| `AddSecondRoleButton.tsx` | Add second role button shown in Profile > Settings — allows single-role users to add the missing role and triggers onboarding |
| `roles.types.ts` | Shared types and prop interfaces for all roles screens |
| `__tests__/RoleSelectionScreen.spec.tsx` | Component tests: rendering, selection toggling, submission |
| `__tests__/HostOnboardingScreen.spec.tsx` | Component tests: steps navigation, validation, submission |
| `__tests__/` | Component and unit tests |

## Flow

```
Email Verified → RoleSelectionScreen → POST /users/roles
  ├── Host selected → HostOnboardingScreen → Host Main View
  ├── Cleaner selected → CleanerOnboardingScreen → Cleaner Main View
  └── Both selected → First role's onboarding → Switch to second later
```

## Cleaner Onboarding Steps

| Step | Required | Description |
|------|----------|-------------|
| 1. KYC Trigger | Yes | Informational card about identity verification; marks step as acknowledged |
| 2. Work Zone | Yes | Placeholder map with radius input; actual Mapbox comes later |
| 3. Availability | Yes | Day-of-week chips with time slot toggles (morning/afternoon/evening/full day) |
| 4. Specialties | No | Multi-select chip list (airbnb, offices, homes, post_event, deep_cleaning, move_in_out) |

## Dependencies

- `react-native-reanimated` — Spring entrance and FadeIn/FadeOut step transitions
- `react-native-safe-area-context` — Safe area wrapper
- `expo-router` — Navigation to main views after onboarding
- Auth store (`src/stores/auth.store.ts`) — User session state and pre-filled names
- API service (`src/services/api.service.ts`) — POST host/cleaner profile on completion

## Design Decisions

- Role cards use emoji icons (no external icon library dependency)
- Selection is toggle-based: tap to select, tap again to deselect
- At least one role must be selected to enable the Continue button
- Props pattern with callbacks (`onComplete`, `onSkip`) for testability
- Spring animations for entrance and selection state changes
- Work zone uses a placeholder circular visual until Mapbox integration
- Availability stored as JSONB-compatible object (`{ monday: ['morning', 'afternoon'], ... }`)
- KYC step is acknowledgment-only — actual verification is in `kyc-verification` spec
- Specialties step is fully optional and skippable
