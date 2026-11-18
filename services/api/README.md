# @bidclean/api

## Purpose

Core backend API for BidClean. Handles business logic, data persistence, integrations with external services (Stripe, OneSignal, RevenueCat, LiveKit, Keycloak, the AI service) and real-time orchestration through Centrifugo. Per-feature details live in each module README, indexed in [`src/README.md`](src/README.md).

## Tech

- **Framework:** NestJS 10 (TypeScript)
- **Database:** PostgreSQL + PostGIS via TypeORM (migrations only, `synchronize: false`)
- **Validation:** class-validator / class-transformer through a global `ValidationPipe`
- **Cache / queues:** Redis, BullMQ (`@nestjs/bullmq`)
- **Realtime:** Centrifugo (WebSocket)
- **Tests:** Jest + ts-jest, fast-check for property-based tests

## Files

| File | Responsibility |
|------|---------------|
| `package.json` | Package `@bidclean/api`: scripts (`dev`, `build`, `start`, `test`, `lint`, `typecheck`, `migration:*`) and dependencies. |
| `tsconfig.json` | TypeScript configuration (`rootDir: ./src`). |
| `jest.config.js` | Jest setup: `src/**/*.spec.ts`, ts-jest, `@bidclean/shared` mapped to `packages/shared/src`, setup file `test/setup-env.ts`. |
| `test/setup-env.ts` | Environment variables for the unit-test run. |
| `src/` | Application source. See [`src/README.md`](src/README.md). |

## Modules

The 19 feature modules imported by `AppModule`:

| Module | Responsibility |
|--------|---------------|
| `health/` | `GET /health` liveness endpoint |
| `auth/` | Keycloak OAuth2/OIDC, sessions, biometric login, Centrifugo tokens (owns the users entity) |
| `roles/` | Host/Cleaner roles and onboarding |
| `kyc/` | Identity verification workflow |
| `profile/` | Profile, settings, portfolio, account deletion |
| `properties/` | Property management |
| `offers/` | Offer publishing, radar delivery, available offers |
| `negotiation/` | Counter-offers |
| `payments/` | Stripe Connect escrow |
| `subscriptions/` | RevenueCat subscriptions |
| `commission/` | Commission rules and rates |
| `chat/` | Messaging, voice notes, VoIP |
| `notifications/` | OneSignal push and outbox relay |
| `service-tracking/` | Live service sessions |
| `video-verification/` | On-arrival video verification |
| `checklist-photos/` | Checklist photo evidence |
| `service-completion/` | Completion and ratings |
| `dispute-system/` | Disputes and evidence |
| `favorites/` | Favorite cleaners |

Infrastructure folders: `common/`, `config/`, `migrations/`.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Service health check |

All other endpoints are documented in the module READMEs.

## How to Run

```powershell
# PowerShell, from the repo root
docker compose -f infra/docker-compose.yml up -d
npm install
npm run migration:run --workspace=services/api
npm run dev --workspace=services/api
```

Tests: `npm test --workspace=services/api`.

## Environment Variables

Core variables are listed below. Each module README lists its own, and the root `.env.example` is the full reference.

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | API server port (default: 3000) | No |
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `REDIS_URL` | Redis connection string | Yes |
| `STRIPE_SECRET_KEY` | Stripe API secret key | Yes |
| `ONESIGNAL_APP_ID` | OneSignal application ID | Yes |
| `REVENUECAT_API_KEY` | RevenueCat API key | Yes |
