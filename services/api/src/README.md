# API Source (`services/api/src`)

## Purpose

Source root of the NestJS API. `main.ts` boots the application and `app.module.ts` composes every feature module. Each feature lives in its own folder (feature-based layout) with its own README; cross-cutting infrastructure lives in `common/`, `config/` and `migrations/`.

## Files

| File / Folder | Responsibility |
|---------------|---------------|
| `main.ts` | Bootstrap: `NestFactory.create(AppModule, { rawBody: true })` (raw body is required for Stripe webhook signature checks), global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`; DTOs use class-validator), listens on `PORT` (default 3000). |
| `app.module.ts` | Root module. Imports `ConfigModule` (global, reads `../../.env`), `TypeOrmModule.forRootAsync` (PostgreSQL from `DATABASE_URL`, `synchronize: false`, entities by glob, migrations from `migrations/`), `BullModule.forRootAsync` (global BullMQ connection parsed from `REDIS_URL`, default `redis://localhost:6379`) and the 19 feature modules below. |
| [`auth/`](auth/README.md) | Keycloak OAuth2/OIDC, sessions, biometric login, Centrifugo tokens, JWT and rate-limit guards. Also owns the `users` table entity. |
| [`roles/`](roles/README.md) | Host/Cleaner roles, active role and onboarding status. |
| [`kyc/`](kyc/README.md) | Identity verification workflow, state machine, AI client, admin review. |
| [`profile/`](profile/README.md) | Profile details, settings, portfolio photos, account deletion. |
| [`properties/`](properties/README.md) | Property CRUD, photos, idempotency keys. |
| [`offers/`](offers/README.md) | Offer publishing, state machine, radar delivery, radius expansion, available-offers feed. |
| [`negotiation/`](negotiation/README.md) | Counter-offers, proposal state machine, expiry. |
| [`payments/`](payments/README.md) | Stripe Connect, escrow charge/release, refunds, webhooks. |
| [`commission/`](commission/README.md) | Commission rules, rate resolution, admin API. |
| [`subscriptions/`](subscriptions/README.md) | RevenueCat subscription state and events. |
| [`chat/`](chat/README.md) | Conversations, messages, voice notes (`chat/voice`), VoIP calls (`chat/voip`). |
| [`notifications/`](notifications/README.md) | OneSignal push, outbox relay, device registry, preferences. |
| [`service-tracking/`](service-tracking/README.md) | Live service sessions and GPS tracking. |
| [`video-verification/`](video-verification/README.md) | On-arrival video face verification. |
| [`checklist-photos/`](checklist-photos/README.md) | Checklist runs, tasks and task photos. |
| [`service-completion/`](service-completion/README.md) | Completion, ratings and release intents. |
| [`dispute-system/`](dispute-system/README.md) | Disputes, evidence, SLA sweeps, financial intents. |
| [`favorites/`](favorites/README.md) | Host favorite cleaners and the favorites delivery window. |
| [`health/`](health/README.md) | `GET /health` liveness endpoint. |
| [`common/`](common/README.md) | API-local shared infrastructure (outbox writer). |
| [`config/`](config/README.md) | TypeORM data source and Redis client. |
| [`migrations/`](migrations/README.md) | TypeORM migrations. |

## Dependencies

- `@nestjs/*`, `typeorm`, `pg`, `bullmq` / `@nestjs/bullmq`, `class-validator`, `class-transformer` (see `../package.json`).
- PostgreSQL (with PostGIS), Redis, MinIO, Keycloak, Centrifugo, the AI service, Stripe, OneSignal, LiveKit, RevenueCat (per feature module).

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | HTTP port (default 3000) | No |
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `REDIS_URL` | Redis URL used by BullMQ and the Redis client | Yes |
| `NODE_ENV` | `development` enables TypeORM query logging | No |

Feature-specific variables are documented in each module README and in the root `.env.example`.

## How to Run

```powershell
# PowerShell, from the repo root
docker compose -f infra/docker-compose.yml up -d
npm run migration:run --workspace=services/api
npm run dev --workspace=services/api
```
