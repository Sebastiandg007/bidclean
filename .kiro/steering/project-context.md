---
inclusion: always
---

# BidClean — Project Context

## Identity

BidClean is a global platform that connects properties with verified cleaning professionals through real-time offers. Property owners publish what they need and propose a price. Nearby professionals receive the request instantly and decide whether to accept or negotiate. Payment is held in escrow until both parties are satisfied.

**Mission:** Dignify cleaning services by connecting spaces with verified professionals, where the price is fair, payment is secure, and trust is built with technology — not luck.

## Technical Stack

- **Frontend:** React Native + Expo (single codebase for iOS, Android, Samsung Galaxy)
- **State Management:** Zustand (one store per domain)
- **Backend API:** NestJS (TypeScript)
- **AI/ML Microservice:** FastAPI (Python)
- **Database:** PostgreSQL + PostGIS
- **Cache/Queue:** Redis + BullMQ
- **Realtime:** Centrifugo (WebSocket)
- **VoIP/Video:** LiveKit (self-hosted)
- **Object Storage:** MinIO (S3-compatible)
- **Authentication:** Keycloak (OAuth2/OIDC)
- **Translation:** LibreTranslate (self-hosted)
- **Speech-to-Text:** Whisper.cpp (CPU)
- **Text-to-Speech:** Piper (CPU)
- **AI Models:** AWS Bedrock (only cloud service)
- **Payments:** Stripe Connect (escrow, multi-currency)
- **Subscriptions/Ads:** RevenueCat SDK
- **Push Notifications:** OneSignal
- **Maps:** Mapbox (custom dark style)
- **CI/CD:** Codemagic (mobile) + GitHub Actions (backend)
- **Monitoring:** Prometheus + Grafana + Loki + Sentry
- **Reverse Proxy:** Traefik (auto SSL via Let's Encrypt)
- **Infrastructure:** Self-hosted VPS (8 cores, 32GB RAM), Docker Compose

## Design System

- **Brand color (accent):** `#00F5D4` (mint green — used only for CTAs and actions)
- **Dark mode background:** `#0B0C10`
- **Card/container background:** `#1F2833`
- **Primary text:** `#FFFFFF`
- **Light mode background:** `~#F5F2EB` (warm off-white, not pure white)
- **Typography:** Custom font with personality (Space Grotesk / Cabinet Grotesk / Satoshi)
- **Icons:** Custom line icons, not generic libraries
- **Animations:** Reanimated 3, spring physics, shared element transitions

## Architecture

- Monorepo structure: `apps/`, `services/`, `packages/`, `infra/`, `docs/`
- Feature-based folder organization (not type-based)
- One file = one responsibility
- All configuration via environment variables (nothing hardcoded)
- Multi-country: Colombia, USA, Canada, Europe (day 1)
- Multi-language: ES, EN, FR, DE, IT, PT, NL
- Multi-currency: COP, USD, CAD, EUR, GBP

## Domain

- **Website:** bidclean.tech
- **API:** api.bidclean.tech
- **WebSocket:** ws.bidclean.tech
- **RTC:** rtc.bidclean.tech
- **Storage:** storage.bidclean.tech
- **Auth:** auth.bidclean.tech

## Business Model

- 13% commission per service (10% from Host + 3% from Cleaner)
- Stripe Connect escrow (charge immediately, hold, release on satisfaction)
- Subscriptions: Cleaner PRO ($4.99/mo), Host PRO ($9.99/mo) via RevenueCat
- Ads: RevenueCat Ads for free-tier users
- Web funnels: RevenueCat Funnels + Stripe for corporate packages
