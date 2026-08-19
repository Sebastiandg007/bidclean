# Changelog

All notable changes to the BidClean project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial project structure and configuration (2026-08-16)
- Kiro steering files (Clean Code, TypeScript, Python, React Native, Git, Documentation standards)
- Kiro hooks (lint-on-save, python-lint, update-docs-on-change, run-tests-after-task)
- Architecture documentation with Mermaid diagrams
- Architecture Decision Records (ADR-001 through ADR-005)
- Contributing guide
- EditorConfig and gitignore
- **Auth module** — complete Keycloak-based authentication system (2026-08-17)
  - Registration with email + password via Keycloak
  - Login via Keycloak Authorization Code + PKCE (system browser)
  - JWT validation via JWKS endpoint
  - Biometric authentication (challenge/response with device keypair)
  - Session metadata tracking (per device)
  - Logout (single device + all devices via Keycloak Admin API)
  - Rate limiting (Redis-backed, configurable per endpoint type)
  - Email verification status sync from Keycloak
  - Database migration for users, auth_sessions, biometric_credentials, biometric_challenges
  - Unit tests for auth, biometric, session, and email verification services
- **Roles module** — scaffolded role management system
  - Module structure: controller, service, types, DTOs, entities, tests
  - TypeORM entities for `host_profiles` and `cleaner_profiles`
  - DTOs with class-validator for assign-roles, host-profile, cleaner-profile
  - Enums: UserRole (host/cleaner), OnboardingStatus (NOT_STARTED/IN_PROGRESS/COMPLETED)
  - Controller with all six endpoints (stubs, guarded by JwtAuthGuard)
  - Registered in AppModule
  - Database migration for role columns on `users` table and `host_profiles`/`cleaner_profiles` tables (with PostGIS GiST index)
- **Roles module** — `POST /users/roles` endpoint fully implemented
  - Assigns one or both roles to authenticated user (idempotent)
  - Sets `active_role` to first selected role when not previously set
  - Initializes onboarding status to IN_PROGRESS for newly assigned roles
  - Returns 404 if user not found, 200 with current state for re-assignments
  - Unit tests for assignRoles (6 test cases covering all scenarios)
- **Roles module** — `GET /users/me/roles` endpoint fully implemented
  - Returns user's assigned roles array and current active role
  - Reuses `findUserOrFail` helper for consistent 404 handling
  - Unit tests for getUserRoles (4 test cases)
- **Roles module** — `PATCH /users/me/active-role` endpoint fully implemented
  - Switches active role for authenticated user (idempotent)
  - Validates target role is assigned to the user (BadRequestException if not)
  - DTO validation via class-validator (rejects invalid enum values)
  - Returns 404 if user not found, 400 if role not assigned
- Task execution rules steering file
- ROADMAP.md for spec tracking
- **Roles module** — `POST /users/me/host-profile` endpoint fully implemented
  - Creates or updates Host onboarding profile (upsert/idempotent)
  - Validates user has the 'host' role assigned (ForbiddenException if not)
  - Validates businessName is required when isBusiness is true (BadRequestException)
  - Saves displayName, isBusiness, businessName, paymentMethodAdded
  - Returns full HostProfile entity
- Hooks: commit-after-task, no-hardcoded-values, verify-tests-executed
- **Roles module** — `POST /users/me/cleaner-profile` endpoint fully implemented
  - Creates or updates Cleaner onboarding profile (upsert/idempotent)
  - Validates user has the 'cleaner' role assigned (ForbiddenException if not)
  - Saves displayName, workZoneLat, workZoneLng, workZoneRadiusKm, availability, specialties
  - Preserves existing values for optional fields not provided in the request
  - Returns full CleanerProfile entity
- **Roles module** — `GET /users/me/onboarding-status` endpoint fully implemented
  - Returns onboarding completion status per role with step-level detail
  - Infers step completion from profile data (no separate tracking columns needed)
  - Host steps: displayNameConfirmed, paymentMethodAdded
  - Cleaner steps: kycStarted, workZoneSet, availabilitySet
  - Returns null for roles not assigned to the user
  - Auto-updates user onboarding status to COMPLETED when all steps are done
  - Enhanced OnboardingStatusResponse type with generic RoleOnboardingDetail interface
