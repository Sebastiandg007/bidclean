# Implementation Plan

## Overview

Implementation tasks for the User Roles feature. Covers role selection, Host/Cleaner onboarding flows, role switching, and role-based navigation on both backend (NestJS) and mobile (React Native/Expo).

## Tasks

- [x] 1. Create roles module structure (module, controller, service, types, DTOs, entities, tests folder, README)
- [x] 2. Create database migration for host_profiles and cleaner_profiles tables + user table role columns
- [x] 3. Implement assign-roles endpoint (POST /users/roles — validate, assign, set active_role)
- [x] 4. Implement get-roles endpoint (GET /users/me/roles — return roles array and active role)
- [x] 5. Implement switch active role endpoint (PATCH /users/me/active-role — validate role is assigned, update)
- [x] 6. Implement Host profile creation endpoint (POST /users/me/host-profile — save display name, business info)
- [x] 7. Implement Cleaner profile creation endpoint (POST /users/me/cleaner-profile — save work zone, availability, specialties)
- [x] 8. Implement onboarding status endpoint (GET /users/me/onboarding-status — return completion per role)
- [x] 9. Implement onboarding gate guard (middleware that blocks access to role features if onboarding is incomplete)
- [x] 10. Write unit tests for roles service (assign, get, switch, add second role, idempotent assignment)
- [x] 11. Write unit tests for onboarding status logic (completion checks, gate validation)
- [x] 12. Create role selection screen (RoleSelectionScreen.tsx — two options, single/dual selection, submit)
- [x] 13. Create Host onboarding screen (HostOnboardingScreen.tsx — name confirmation, payment method step)
- [x] 14. Create Cleaner onboarding screen (CleanerOnboardingScreen.tsx — KYC trigger, map zone picker, availability picker, specialties)
- [x] 15. Create role-based navigation router (RoleBasedNavigator.tsx — renders Host or Cleaner tabs based on active role)
- [x] 16. Create Host navigator (HostNavigator.tsx — 4 tabs: Home, Properties, Activity, Profile)
- [x] 17. Create Cleaner navigator (CleanerNavigator.tsx — 3 tabs: Radar, Active, Profile)
- [-] 18. Extend auth.store.ts with role state (activeRole, roles array, switchRole action, addRole action)
- [ ] 19. Implement role switch in Profile screen (button that calls switchRole and swaps navigator instantly)
- [ ] 20. Implement "Add second role" option in Profile > Settings (triggers onboarding for new role)
- [ ] 21. Implement role state persistence (save activeRole to SecureStore, restore on app launch)
- [ ] 22. Write component tests for RoleSelectionScreen (render, selection, submission)
- [ ] 23. Write component tests for HostOnboardingScreen (steps, validation)
- [ ] 24. Write component tests for CleanerOnboardingScreen (steps, map, availability)
- [ ] 25. Write component tests for RoleBasedNavigator (correct tabs per role)

## Task Dependency Graph

```json
{
  "waves": [
    [1, 2, 12, 18],
    [3, 4, 5, 6, 7, 8, 13, 14, 15, 21],
    [9, 10, 11, 16, 17, 19, 20],
    [22, 23, 24, 25]
  ]
}
```

## Notes

- This spec extends the existing `users` table with new columns (roles, active_role, onboarding flags)
- The auth.store.ts from the auth module is extended, not replaced
- KYC trigger in Cleaner onboarding only starts the flow — actual verification is in `kyc-verification` spec
- Payment method in Host onboarding only captures intent — actual Stripe setup is in `stripe-escrow` spec
- Work zone selection uses Mapbox map component (same instance as radar, configured for zone picking)
- Role switching is purely frontend state + one backend PATCH — no re-auth needed
