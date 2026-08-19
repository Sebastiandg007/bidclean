# Roles Module

## Purpose

Manages user role assignment (Host/Cleaner), role-specific onboarding profiles, role switching, and onboarding status tracking. After authentication and email verification, users must select at least one role before accessing the main application features.

## Files

| File | Responsibility |
|------|---------------|
| `roles.module.ts` | NestJS module registration (entities, controller, service, guards) |
| `roles.controller.ts` | HTTP endpoints for role management and onboarding |
| `roles.service.ts` | Business logic for role assignment, switching, and profiles |
| `roles.types.ts` | TypeScript enums and interfaces (UserRole, OnboardingStatus) |
| `dto/assign-roles.dto.ts` | Validation for role assignment requests |
| `dto/switch-active-role.dto.ts` | Validation for active role switch requests |
| `dto/host-profile.dto.ts` | Validation for Host onboarding profile data |
| `dto/cleaner-profile.dto.ts` | Validation for Cleaner onboarding profile data |
| `entities/host-profile.entity.ts` | TypeORM entity for `host_profiles` table |
| `entities/cleaner-profile.entity.ts` | TypeORM entity for `cleaner_profiles` table |
| `guards/onboarding-gate.guard.ts` | CanActivate guard that blocks access when onboarding is incomplete |
| `guards/require-onboarding.decorator.ts` | Decorator to specify which role's onboarding to check |
| `guards/index.ts` | Barrel export for guards |
| `__tests__/roles.service.spec.ts` | Unit tests for the roles service |
| `__tests__/roles.controller.spec.ts` | Unit tests for the roles controller |
| `__tests__/onboarding-gate.guard.spec.ts` | Unit tests for the onboarding gate guard |

## Migration

The database schema for this module is managed by:

| Migration | Description |
|-----------|-------------|
| `1700000001000-CreateRoleTables.ts` | Adds role columns (`roles`, `active_role`, `onboarding_status_host`, `onboarding_status_cleaner`) to the `users` table, and creates the `host_profiles` and `cleaner_profiles` tables with indexes (including a PostGIS GiST index on the cleaner work zone for geospatial queries) |

Run migrations with: `npm run migration:run`

## Dependencies

- **Auth module** — JwtAuthGuard for endpoint protection, User entity for FK relations
- **TypeORM** — database access for profile entities
- **class-validator** — DTO validation

## API

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| POST | `/users/roles` | Assign one or both roles to the authenticated user | ✅ Implemented |
| GET | `/users/me/roles` | Get user's assigned roles and active role | ✅ Implemented |
| PATCH | `/users/me/active-role` | Switch the currently active role | ✅ Implemented |
| POST | `/users/me/host-profile` | Save Host onboarding profile data | ✅ Implemented |
| POST | `/users/me/cleaner-profile` | Save Cleaner onboarding profile data | ✅ Implemented |
| GET | `/users/me/onboarding-status` | Get onboarding completion status per role | ✅ Implemented |

## Data Models

### Host Profile (`host_profiles`)
- One-to-one with User (CASCADE delete)
- Stores display name, business info, payment method flag

### Cleaner Profile (`cleaner_profiles`)
- One-to-one with User (CASCADE delete)
- Stores display name, work zone (lat/lng/radius), availability, specialties, portfolio/bank flags

## Business Rules

- A user must select at least one role after registration
- Role assignment is idempotent (re-assigning returns success)
- Active role must be one of the user's assigned roles
- Authorization checks use `roles[]` array, not `active_role`
- Onboarding status is inferred from profile data completeness
- Onboarding auto-completes: if all steps for a role are done, status is updated to COMPLETED

## Onboarding Status Response Shape

The `GET /users/me/onboarding-status` endpoint returns step-level detail:

```json
{
  "host": {
    "status": "IN_PROGRESS",
    "steps": {
      "displayNameConfirmed": true,
      "paymentMethodAdded": false
    }
  },
  "cleaner": null
}
```

- Returns `null` for roles not assigned to the user
- **Host steps:** `displayNameConfirmed` (profile exists with displayName), `paymentMethodAdded`
- **Cleaner steps:** `kycStarted` (profile exists), `workZoneSet` (all zone fields non-null), `availabilitySet` (availability has entries)


## Guards

### OnboardingGateGuard

A `CanActivate` guard that blocks access to role-specific endpoints when the user's onboarding is not completed.

**Usage:**

```typescript
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OnboardingGateGuard, RequireOnboarding } from './guards';
import { UserRole } from './roles.types';

// Require Host onboarding completed
@UseGuards(JwtAuthGuard, OnboardingGateGuard)
@RequireOnboarding(UserRole.HOST)
@Get('properties')
getProperties() { ... }

// Fall back to user's active_role
@UseGuards(JwtAuthGuard, OnboardingGateGuard)
@RequireOnboarding()
@Get('dashboard')
getDashboard() { ... }
```

**Behavior:**
- Must run AFTER `JwtAuthGuard` (requires `request.user` to be set)
- Reads role metadata from `@RequireOnboarding()` decorator
- If no role specified, falls back to user's `active_role`
- Checks that the user has the role assigned (via `roles[]` array)
- Checks that onboarding status for that role is `COMPLETED`
- Throws `403 ForbiddenException` with message: "Complete onboarding to access this feature"

**Exported from:** `RolesModule` (available to any module that imports `RolesModule`)
