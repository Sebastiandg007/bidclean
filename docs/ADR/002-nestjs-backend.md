# ADR-002: NestJS for Backend API

## Status
Accepted

## Context
BidClean needs a backend that handles: REST/GraphQL APIs, WebSocket connections (real-time tracking, chat), job queues (radius expansion, payment release), and integrations with Stripe, OneSignal, RevenueCat, and Mapbox. The team uses TypeScript.

## Decision
We chose NestJS (TypeScript) as the primary backend framework.

## Reasoning
- **Same language as frontend** (TypeScript everywhere) — team can move between layers.
- **Modular architecture** — feature-based modules align with Clean Code principles.
- **Native WebSocket support** — Gateway decorators for real-time features.
- **BullMQ integration** — built-in queue module for background jobs.
- **Dependency Injection** — testable, decoupled code by default.
- **Well-typed** — strict TypeScript with decorators for validation.
- **Mature ecosystem** — Stripe SDK, OneSignal SDK, all available in Node.js.

## Alternatives Considered
- **FastAPI (Python):** Excellent for async APIs, but WebSockets are more manual, and having Python for the main API + frontend in TypeScript means 2 languages for the core team.
- **.NET (C#):** Very performant, but less common in startup/mobile ecosystems, more verbose, would need Python separately for ML anyway.
- **Express/Fastify (Node.js):** Less structured than NestJS — for a team project with multiple developers, NestJS's opinions prevent architectural drift.

## Consequences
- AI/ML features run in a separate Python microservice (FastAPI) since ML tools are Python-native.
- Two services to maintain (NestJS + FastAPI) instead of one.
- The team gets strong typing, module boundaries, and testability out of the box.
