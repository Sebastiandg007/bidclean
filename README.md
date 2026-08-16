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

> 🚧 Project scaffolding in progress. Full setup instructions will be added with each service initialization.

### Prerequisites

- Node.js 20+
- Python 3.11+
- Docker & Docker Compose
- Stripe CLI (installed globally)

### Quick Start

```bash
# Clone the repository
git clone <repo-url> bidclean
cd bidclean

# Install dependencies (when services are initialized)
# npm install          (root workspace)
# cd services/api && npm install
# cd services/ai && poetry install
```

## Documentation

- [Architecture & Diagrams](docs/ARCHITECTURE.md)
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
