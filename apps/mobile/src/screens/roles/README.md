# Roles Screens

## Purpose

Role selection and onboarding screens for BidClean. After email verification, users choose their role (Host, Cleaner, or both) and complete role-specific onboarding before accessing the main app experience.

## Files

| File | Responsibility |
|------|---------------|
| `RoleSelectionScreen.tsx` | Two-card role picker with single/dual selection and animated feedback |
| `HostOnboardingScreen.tsx` | Host onboarding flow: name confirmation + payment method (future) |
| `CleanerOnboardingScreen.tsx` | Cleaner onboarding flow: KYC, work zone, availability (future) |
| `roles.types.ts` | Shared types and prop interfaces for all roles screens |
| `__tests__/` | Component and unit tests |

## Flow

```
Email Verified → RoleSelectionScreen → POST /users/roles
  ├── Host selected → HostOnboardingScreen → Host Main View
  ├── Cleaner selected → CleanerOnboardingScreen → Cleaner Main View
  └── Both selected → First role's onboarding → Switch to second later
```

## Dependencies

- `react-native-reanimated` — Spring entrance and selection animations
- `react-native-safe-area-context` — Safe area wrapper
- `expo-router` — Navigation to onboarding screens
- Auth store (`src/stores/auth.store.ts`) — User session state

## Design Decisions

- Role cards use emoji icons (no external icon library dependency)
- Selection is toggle-based: tap to select, tap again to deselect
- At least one role must be selected to enable the Continue button
- Props pattern with callbacks (`onSubmit`, `onRoleToggled`) for testability
- Spring animations for entrance and selection state changes
