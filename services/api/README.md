# @bidclean/api

## Purpose

Core backend API for BidClean. Handles business logic, data persistence, integrations with external services (Stripe, OneSignal, RevenueCat), and real-time communication orchestration.

## Tech

- **Framework:** NestJS (TypeScript)
- **Database:** PostgreSQL + PostGIS (via TypeORM/Prisma)
- **Cache:** Redis
- **Queue:** BullMQ
- **Realtime:** Centrifugo (WebSocket)

## Modules

| Module | Responsibility | Status |
|--------|---------------|--------|
| `health/` | Health check endpoint for monitoring | ✅ Active |
| `users/` | Registration, profiles, KYC status | 🔲 Planned |
| `offers/` | Offer publishing, negotiation, matching | 🔲 Planned |
| `payments/` | Stripe Connect, escrow, payouts | 🔲 Planned |
| `chat/` | Real-time messaging, translation | 🔲 Planned |
| `notifications/` | OneSignal push, in-app alerts | 🔲 Planned |
| `properties/` | Property CRUD, media uploads | 🔲 Planned |
| `subscriptions/` | RevenueCat integration | 🔲 Planned |
| `favorites/` | Host favorites management | 🔲 Planned |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Service health check |

## How to Run

```bash
cd services/api
npm install
npm run dev
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | API server port (default: 3000) | No |
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `REDIS_URL` | Redis connection string | Yes |
| `STRIPE_SECRET_KEY` | Stripe API secret key | Yes |
| `ONESIGNAL_APP_ID` | OneSignal application ID | Yes |
| `REVENUECAT_API_KEY` | RevenueCat API key | Yes |
