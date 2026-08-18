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
- Task execution rules steering file
- ROADMAP.md for spec tracking
- Hooks: commit-after-task, no-hardcoded-values, verify-tests-executed
