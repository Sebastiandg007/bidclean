---
inclusion: always
---

# Git Conventions

## Commit Messages (Conventional Commits)

Format: `type(scope): short description`

### Types:
- `feat` — New feature
- `fix` — Bug fix
- `docs` — Documentation changes
- `refactor` — Code change that neither fixes a bug nor adds a feature
- `test` — Adding or fixing tests
- `chore` — Build process, dependencies, CI changes
- `style` — Formatting, whitespace (no logic change)
- `perf` — Performance improvement
- `ci` — CI/CD changes

### Scopes (by module):
- `mobile` — React Native app
- `api` — NestJS backend
- `ai` — Python AI microservice
- `infra` — Docker, configs, deployment
- `shared` — Shared packages
- `docs` — Documentation

### Examples:
```
feat(api): add counteroffer endpoint with validation
fix(mobile): resolve map pin clustering at zoom level 12
docs(api): update offers module README with new endpoints
refactor(mobile): extract useOfferTimer hook from RadarScreen
test(api): add property-based tests for commission calculation
chore(infra): update Docker Compose with LiveKit service
```

### Rules:
- Subject line max 72 characters.
- Use imperative mood: "add feature" not "added feature".
- No period at the end of the subject line.
- Body (optional): explain WHY, not WHAT (the diff shows what).
- Reference task/issue if applicable: `Closes #42`.

## Branch Naming

Format: `type/short-description`

```
feature/offers-counteroffer
feature/stripe-escrow-integration
fix/notification-delivery-delay
docs/architecture-mermaid-update
refactor/auth-module-keycloak
chore/docker-compose-livekit
```

### Rules:
- Lowercase, hyphen-separated.
- Short but descriptive (max 5 words after type/).
- Branch from `develop`, merge back to `develop` via PR.
- Delete branch after merge.

## Branching Strategy (Git Flow Simplified)

```
main        ← Production (every merge = deploy)
  └── develop  ← Integration/staging
       ├── feature/xxx
       ├── fix/xxx
       └── refactor/xxx
```

- `main`: always deployable, tagged with version.
- `develop`: integration branch, staging environment.
- Feature branches: short-lived, one feature per branch.
- Hotfixes: branch from `main`, merge to both `main` and `develop`.

## Pull Requests

- Title follows commit convention: `feat(api): add offer creation endpoint`
- Description includes:
  - **What**: Brief summary of changes.
  - **Why**: Context or link to requirement/task.
  - **How to test**: Steps to verify the change works.
- At least 1 approval before merge.
- All CI checks must pass (lint, tests, type-check).
- Squash merge to keep history clean.

## Versioning (Semantic Versioning)

Format: `MAJOR.MINOR.PATCH`

- MAJOR: Breaking changes (API contract changes, major rewrites)
- MINOR: New features (backward compatible)
- PATCH: Bug fixes (backward compatible)

## Tagging

- Tags on `main` for releases: `v1.0.0`, `v1.1.0`, etc.
- CHANGELOG.md auto-generated from conventional commits per release.
