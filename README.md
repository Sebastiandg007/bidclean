# BidClean

> Global platform connecting properties with verified cleaning professionals through real-time offers, transparent pricing, and secure escrow payments.

[![Shipaton 2026](https://img.shields.io/badge/RevenueCat-Shipaton%202026-00F5D4)](https://shipaton.com)

## What is BidClean?

BidClean connects property owners who need cleaning services with verified professionals nearby. Owners publish what they need and propose a price. Professionals receive instant alerts and can accept or negotiate. Payment is held in escrow until both parties confirm satisfaction.

**Mission:** Dignify cleaning services by connecting spaces with verified professionals, where the price is fair, payment is secure, and trust is built with technology — not luck.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile | React Native + Expo (iOS, Android, Galaxy Store) |
| Backend API | NestJS (TypeScript) |
| AI/ML Service | FastAPI (Python) |
| Database | PostgreSQL + PostGIS |
| Realtime | Centrifugo (WebSocket) + LiveKit (VoIP) |
| Payments | Stripe Connect (Escrow) |
| Subscriptions | RevenueCat |
| Maps | Mapbox |
| Notifications | OneSignal |
| Infrastructure | Docker, self-hosted VPS |

## Project Structure

```
bidclean/
├── apps/
│   ├── mobile/        → React Native + Expo app
│   └── web/           → Landing page (bidclean.tech)
├── services/
│   ├── api/           → NestJS backend
│   └── ai/            → FastAPI AI/ML microservice
├── packages/
│   └── shared/        → Shared types, constants, utilities
├── infra/
│   ├── docker/        → Dockerfiles per service
│   └── scripts/       → Deploy, backup scripts
├── tools/             → config-inventory, full-audit
├── docs/
│   ├── ARCHITECTURE.md → System diagrams (Mermaid)
│   ├── ADR/           → Architecture Decision Records
│   ├── CHANGELOG.md   → Version history
│   └── CONTRIBUTING.md → Team contribution guide
└── .kiro/
    ├── steering/      → Code standards and project rules
    ├── hooks/         → Automated quality checks
    └── settings/      → MCP server configurations
```

## Getting Started

### Prerequisites

- Node.js 20+
- Python 3.11+ and Poetry
- Docker & Docker Compose
- Stripe CLI (installed globally)

### Quick Start

```powershell
# PowerShell, from the repo root
git clone <repo-url> bidclean
cd bidclean
Copy-Item .env.example .env          # then fill in your values (never commit .env)
npm install                          # installs all workspaces

# 1. Infrastructure (Postgres/PostGIS, Redis, MinIO, Keycloak, Centrifugo, LibreTranslate)
docker compose -f infra/docker-compose.yml up -d

# 2. Database migrations. The TypeORM CLI does not read .env: export DATABASE_URL in the shell first
#    (compose Postgres is on host port 15432)
$env:DATABASE_URL = "postgresql://bidclean:bidclean_local@localhost:15432/bidclean"
npm run migration:run --workspace=services/api

# 3. API (http://localhost:3000/health)
npm run dev --workspace=services/api

# 4. AI service (http://localhost:8000/health/), in a second terminal
cd services/ai
poetry install
poetry run uvicorn src.main:app --reload --port 8000
```

The compose file publishes Postgres on host port `15432` and Redis on `16379` (to avoid Windows reserved port ranges), so set `DATABASE_URL` and `REDIS_URL` in `.env` accordingly.

The mobile app uses native modules and does not run in Expo Go. Build it with EAS; see [apps/mobile/BUILD.md](apps/mobile/BUILD.md).

## Documentation

- [Interactive architecture viewer (Spanish)](docs/architecture/index.html)
- [Architecture & Diagrams](docs/ARCHITECTURE.md)
- [Mobile build guide (EAS)](apps/mobile/BUILD.md)
- [Deployment readiness](docs/deployment/) (checklist and runbook)
- [Configuration inventory](docs/CONFIGURATION-INVENTORY.md)
- [Tools](tools/README.md) (config inventory, full audit)
- [Contributing Guide](docs/CONTRIBUTING.md)
- [Changelog](docs/CHANGELOG.md)
- [Architecture Decisions](docs/ADR/)

## Design System

| Token | Value |
|-------|-------|
| Brand Accent | `#00F5D4` (Mint) |
| Dark Background | `#0B0C10` |
| Card Background | `#1F2833` |
| Text Primary | `#FFFFFF` |
| Light Mode BG | `#F5F2EB` |

## License

Proprietary. All rights reserved.

---

*Built for [RevenueCat Shipaton 2026](https://shipaton.com)*
