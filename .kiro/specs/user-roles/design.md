# Design Document

## Overview

The user roles system determines which experience a user sees in BidClean. After authentication, users select Host, Cleaner, or both. Each role has its own onboarding flow, navigation structure, and data scope. Role switching is instantaneous and purely client-side (no re-authentication). The backend stores role profiles and the frontend manages the active role state.

## Architecture

The role system is split between backend (persistent role data) and frontend (active role UI state):

```
Mobile App
├── Role Selection Screen (post-auth, one-time per role)
├── Host Onboarding Flow (if Host selected)
├── Cleaner Onboarding Flow (if Cleaner selected)
├── Role-based Navigation Router
│   ├── Host Navigation (4 tabs: Home, Properties, Activity, Profile)
│   └── Cleaner Navigation (3 tabs: Radar, Active, Profile)
└── Role Switch (Profile > switch button)

NestJS API
├── POST /users/roles — assign role to user
├── GET /users/me/roles — get user's roles
├── PATCH /users/me/active-role — update active role
├── POST /users/me/host-profile — create host onboarding data
├── POST /users/me/cleaner-profile — create cleaner onboarding data
└── GET /users/me/onboarding-status — check onboarding completion
```

## Components and Interfaces

### API Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/users/roles` | Assign one or both roles to user | Access token |
| GET | `/users/me/roles` | Get user's assigned roles and active role | Access token |
| PATCH | `/users/me/active-role` | Update which role is currently active | Access token |
| POST | `/users/me/host-profile` | Save Host onboarding data (name, payment method ref) | Access token |
| POST | `/users/me/cleaner-profile` | Save Cleaner onboarding data (work zone, availability, specialties) | Access token |
| GET | `/users/me/onboarding-status` | Get onboarding completion status per role | Access token |

### Component Structure (Backend)

```
services/api/src/roles/
├── roles.module.ts
├── roles.controller.ts
├── roles.service.ts
├── roles.types.ts
├── dto/
│   ├── assign-roles.dto.ts
│   ├── host-profile.dto.ts
│   └── cleaner-profile.dto.ts
├── entities/
│   ├── host-profile.entity.ts
│   └── cleaner-profile.entity.ts
├── __tests__/
│   ├── roles.service.spec.ts
│   └── roles.controller.spec.ts
└── README.md
```

### Component Structure (Mobile)

```
apps/mobile/src/screens/roles/
├── RoleSelectionScreen.tsx
├── HostOnboardingScreen.tsx
├── CleanerOnboardingScreen.tsx
├── useRoleSelection.ts
├── useOnboarding.ts
├── roles.types.ts
├── __tests__/
│   ├── RoleSelectionScreen.spec.tsx
│   ├── HostOnboardingScreen.spec.tsx
│   └── CleanerOnboardingScreen.spec.tsx
└── README.md

apps/mobile/src/navigation/
├── RoleBasedNavigator.tsx
├── HostNavigator.tsx
├── CleanerNavigator.tsx
└── README.md
```

## Data Models

### User Table Extension (adds role fields to existing users table)

```sql
ALTER TABLE users ADD COLUMN roles VARCHAR(50)[] DEFAULT '{}';
ALTER TABLE users ADD COLUMN active_role VARCHAR(20);
ALTER TABLE users ADD COLUMN onboarding_status_host VARCHAR(20) DEFAULT 'NOT_STARTED';
ALTER TABLE users ADD COLUMN onboarding_status_cleaner VARCHAR(20) DEFAULT 'NOT_STARTED';
```

> **Onboarding status values:** `NOT_STARTED`, `IN_PROGRESS`, `COMPLETED`
> Individual step completion is inferred from profile data (e.g., if `host_profiles.payment_method_added = true`, that step is done).
> **Note on payment_method_added and bank_account_added:** These are MVP indicators. Stripe is the source of truth for payment readiness — these booleans will be replaced by `stripe_customer_id` / `stripe_connect_account_id` in the `stripe-escrow` spec.

### Host Profile Table

```sql
CREATE TABLE host_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    display_name VARCHAR(255) NOT NULL,
    is_business BOOLEAN DEFAULT FALSE,
    business_name VARCHAR(255),
    payment_method_added BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_host_profiles_user ON host_profiles(user_id);
```

### Cleaner Profile Table

```sql
CREATE TABLE cleaner_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    display_name VARCHAR(255) NOT NULL,
    work_zone_lat DOUBLE PRECISION,
    work_zone_lng DOUBLE PRECISION,
    work_zone_radius_km DOUBLE PRECISION,
    availability JSONB DEFAULT '{}',
    specialties VARCHAR(50)[] DEFAULT '{}',
    has_portfolio BOOLEAN DEFAULT FALSE,
    bank_account_added BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_cleaner_profiles_user ON cleaner_profiles(user_id);
CREATE INDEX idx_cleaner_profiles_zone ON cleaner_profiles USING GIST (
    ST_MakePoint(work_zone_lng, work_zone_lat)
);
```

## Auth Flows

### Role Selection Flow
```
User verifies email
        ↓
App checks: user.roles is empty?
        ↓ YES
Navigate to RoleSelectionScreen
        ↓
User taps "I need cleaning" (Host) and/or "I want to work" (Cleaner)
        ↓
POST /users/roles { roles: ['host'] } or { roles: ['host', 'cleaner'] }
        ↓
Backend assigns roles, sets active_role to first selected
        ↓
Navigate to onboarding for active role
```

### Role Switching Flow
```
User taps "Switch to [other role]" in Profile
        ↓
Frontend immediately updates auth.store.activeRole (local)
        ↓
Navigation instantly swaps to other role's tabs
        ↓
PATCH /users/me/active-role { activeRole: 'cleaner' } runs ASYNC (fire-and-forget)
        ↓
Backend persists preference (if fails, retry later — UI already switched)
```

### Adding Second Role Flow
```
User taps "Add [other role]" in Profile > Settings
        ↓
POST /users/roles { roles: ['host', 'cleaner'] }
        ↓
Navigate to onboarding for the new role
        ↓
After onboarding, user can switch between both roles
```

## Error Handling

| Error Case | HTTP Status | Response |
|-----------|-------------|----------|
| Invalid role value | 400 | "Invalid role. Must be 'host' or 'cleaner'" |
| No role selected | 400 | "At least one role must be selected" |
| Onboarding incomplete (trying to access features) | 403 | "Complete onboarding to access this feature" |
| User does not have required role for endpoint | 403 | "Role 'cleaner' is required to access this resource" |
| Role already assigned (idempotent) | 200 | Returns current roles state (no error) |

> **Note:** Assigning a role that's already assigned is idempotent — returns 200 with current state, no 409.
> **Note:** All role-specific endpoints (host-profile, cleaner-profile) MUST verify the user has that role assigned before proceeding. Authorization is by `roles[]`, not `active_role`.

## Testing Strategy

### Unit Tests
- Roles service: assign role, get roles, switch active role, add second role
- Onboarding status: check completion per role, mark steps as done

### Component Tests (Mobile)
- RoleSelectionScreen: renders both options, handles single/dual selection
- HostOnboardingScreen: renders steps, validates required fields
- CleanerOnboardingScreen: renders steps, map zone picker, availability picker
- RoleBasedNavigator: renders correct tabs for active role

## Correctness Properties

### Property 1: Role Invariant
A user must always have at least one role assigned after completing role selection. The `roles` array is never empty once role selection is done.

### Property 2: Active Role Validity
The `active_role` field must always be one of the values in the `roles` array. It cannot be a role the user hasn't selected.

### Property 3: Onboarding Gate
A user cannot access role-specific main features if `onboarding_completed_{role}` is false for that role.

### Property 4: Separation of Data
A Host profile query never returns Cleaner profile data and vice versa. Endpoints are scoped by active role.

### Property 5: Idempotent Role Assignment
Assigning a role that's already assigned returns success without creating duplicates.

## Dependencies

### Backend
- Existing `users` table from `user-authentication` spec
- JWT auth guard (from auth module)
- TypeORM for entity management

### Mobile
- Auth store (from auth module) — extends with `activeRole` field
- Expo Router for navigation switching
- Mapbox for work zone selection (Cleaner onboarding)
- Zustand store extension
