# Requirements Document

## Introduction

After registration and email verification, users must select their role in BidClean: Host (property owner needing cleaning) or Cleaner (professional offering cleaning services). A user can have both roles but accesses each through completely separate experiences. This spec covers role selection, role-specific onboarding, and the mechanism to switch between roles.

## Glossary

| Term | Definition |
|------|-----------|
| Host | A user who owns/manages properties and publishes cleaning offers |
| Cleaner | A professional who accepts cleaning jobs and earns money |
| Role Selection | The one-time (per role) process of choosing Host or Cleaner after registration |
| Role Switch | The action of moving between Host and Cleaner views when a user has both roles |
| Onboarding | Role-specific setup steps that must be completed before using that role's features |

## Requirements

### REQ-1: Role Selection After Registration
- When: after email verification is confirmed, the user is presented with role selection
- The system shall display two options: "I need cleaning" (Host) and "I want to work" (Cleaner)
- The user shall select at least one role to proceed
- The user may select both roles (creates both profiles)
- Role selection is mandatory — the user cannot access main app features without choosing a role
- The selected role determines which onboarding flow starts

### REQ-2: Host Onboarding
- When: a user selects the Host role, the system shall guide them through Host-specific setup
- Required steps:
  - Confirm personal/business name (pre-filled from registration)
  - Add payment method (card for Stripe — required for publishing offers later)
- Optional steps (can be completed later):
  - Register first property (guided flow to create an immovable listing)
- After onboarding, the user enters the Host main view (Home tab)

### REQ-3: Cleaner Onboarding
- When: a user selects the Cleaner role, the system shall guide them through Cleaner-specific setup
- Required steps:
  - Start KYC verification (document + selfie — actual KYC is handled in `kyc-verification` spec)
  - Set work zone (radius on map where they want to receive offers)
  - Set availability (days/hours they're available to work)
- Optional steps (can be completed later):
  - Add specialties (Airbnb, offices, homes, post-event, etc.)
  - Upload portfolio photos (before/after gallery)
  - Add bank account for payouts (Stripe Connect onboarding)
- After onboarding, user enters the Cleaner main view (Radar tab)
- **Starting KYC is required to complete Cleaner onboarding, but KYC approval is NOT required to enter the Cleaner experience**
- **KYC verification (VERIFIED status) IS required before the Cleaner can accept any offers**

### REQ-4: Completely Separate Experiences
- When: a user is in Host mode, they shall NOT see any Cleaner functionality
- When: a user is in Cleaner mode, they shall NOT see any Host functionality
- Navigation tabs, screens, and data are entirely different per role
- The user's current active role is persisted and restored on app restart
- **Active role controls navigation and presentation ONLY. It MUST NOT be used as the sole authorization mechanism**
- **Backend authorization is ALWAYS based on the user's assigned roles (`roles` array), not `active_role`**
- A user can only access role-specific resources if that role is actually assigned

### REQ-5: Role Switching
- If: a user has both roles (Host + Cleaner), they can switch between them
- The switch option is accessible from the Profile tab (both views)
- Switching roles changes the entire app navigation and visible data
- Switching does NOT require re-authentication
- **The switch is instant: frontend immediately updates `activeRole` and swaps navigation**
- **PATCH /users/me/active-role runs asynchronously (fire-and-forget) to persist the preference**
- If the PATCH fails, the local state is retained and retried later

### REQ-6: Adding a Second Role
- If: a user initially chose only Host, they can later add Cleaner (and vice versa)
- Adding a second role triggers the onboarding flow for that role
- The original role is not affected
- The option to add a second role is in Profile > Settings

### REQ-7: Role State Persistence
- The user's current active role persists across app restarts
- If the user was last in Host mode, the app opens in Host mode
- Role state is stored locally (SecureStore) and synced with the backend

## Non-Functional Requirements

- Role selection screen loads in under 300ms
- Switching roles takes less than 100ms (local state change, no network call)
- Onboarding flows are skippable for optional steps (user can complete later)
- All role-related UI follows the dark theme design system

## Out of Scope

- KYC verification details → `kyc-verification` spec
- Property creation details → `property-management` spec
- Stripe Connect onboarding for Cleaners → `stripe-escrow` spec
- Navigation tab structure details → handled as part of each role's screens
- **Role removal/deactivation → Out of scope for v1**
