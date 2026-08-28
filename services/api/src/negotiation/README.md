# Negotiation Module (API)

## Purpose

Finalizes the match between a Host and a Cleaner after an offer is ACTIVE. A Cleaner can directly accept an offer at the Host's price, or run a bounded counteroffer negotiation (Cleaner proposes → Host accepts/rejects/counters → Cleaner accepts/declines). Acceptance always goes through the `OfferMatchContract` (`OFFER_MATCH`); this module never writes the `offers` table directly.

## Files

| File | Responsibility |
|------|---------------|
| `negotiation.controller.ts` | Cleaner + Host REST endpoints; JWT auth, role resolution, mandatory Idempotency-Key |
| `negotiation.service.ts` | Orchestration: revalidate → mutate → match (via contract) → publish |
| `negotiation.repository.ts` | Thread/proposal reads & writes; `SELECT … FOR UPDATE` sequence allocation |
| `negotiation-idempotency.service.ts` | At-most-once mutations per `(user, operation, key)` (Property P9) |
| `negotiation.constants.ts` | Env-configurable values + startup validation (fail-fast) |
| `negotiation.types.ts` | Enums (actor, status, superseded reason) and view/summary types |
| `negotiation.messages.ts` | Centralized backend error messages |
| `proposal-state-machine.ts` | Pure proposal transition validation (only PENDING is non-terminal) |
| `pricing/negotiation-pricing.service.ts` | Wraps `CommissionService`; deviation bounds vs immutable Base Price |
| `events/negotiation-events.ts` | Event names + envelope (eventId, version, sequenceNumber) |
| `events/negotiation-publisher.service.ts` | Scoped Centrifugo publishing; best-effort (never rolls back) |
| `listeners/offer-terminal.listener.ts` | Single supersession authority on `offer.matched/cancelled/expired` |
| `reconciliation/negotiation-reconciliation.service.ts` | Periodic repair of partial post-terminal state |
| `expiration/proposal-expiry.worker.ts` | Marks PENDING proposals EXPIRED past their window |
| `entities/negotiation-thread.entity.ts` | `negotiation_threads` table entity |
| `entities/negotiation-proposal.entity.ts` | `negotiation_proposals` table entity |
| `dto/create-counteroffer.dto.ts` | Cleaner counteroffer payload validation |
| `dto/host-counter.dto.ts` | Host counter-back payload validation |

## Dependencies

- **OffersModule** — injects `OFFER_MATCH` (ACTIVE→MATCHED), `CommissionService` (payout math), and `CentrifugoClient` (real-time transport).
- **EventEmitter2** — subscribes to offer domain events (`offer.matched/cancelled/expired`).
- **@nestjs/schedule** — `@Interval` for the expiration and reconciliation sweeps.
- Tables: `negotiation_threads`, `negotiation_proposals`, `negotiation_idempotency` (migration `1700000013000`); reads `offers`, `offer_deliveries`, `users`.

## API

| Method | Path | Actor | Description |
|--------|------|-------|-------------|
| POST | `/negotiation/offers/:offerId/accept` | Cleaner | Direct accept at Host price → match |
| POST | `/negotiation/offers/:offerId/counteroffers` | Cleaner | Submit a counteroffer |
| POST | `/negotiation/proposals/:proposalId/accept` | Host/Cleaner | Accept counterparty proposal → match |
| POST | `/negotiation/proposals/:proposalId/reject` | Host/Cleaner | Reject counterparty proposal |
| POST | `/negotiation/proposals/:proposalId/counter` | Host/Cleaner | Counter back with a new price |
| GET | `/negotiation/offers/:offerId/thread` | Cleaner | Cleaner's own thread |
| GET | `/negotiation/host/counteroffers` | Host | Inbox of pending Cleaner counteroffers |

All mutations require an `Idempotency-Key` header (400 if missing).

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NEGOTIATION_MIN_DEVIATION_BPS` | Max downward deviation from Base Price (bps) | `2000` |
| `NEGOTIATION_MAX_DEVIATION_BPS` | Max upward deviation from Base Price (bps) | `2000` |
| `NEGOTIATION_RESPONSE_WINDOW_MS` | Proposal response window (ms) | `900000` |
| `NEGOTIATION_MAX_PROPOSALS` | Max proposals per thread | `6` |
| `NEGOTIATION_EXPIRY_SWEEP_MS` | Expiration sweep interval (ms) | `60000` |
| `NEGOTIATION_RECONCILE_INTERVAL_MS` | Reconciliation sweep interval (ms) | `120000` |

## Correctness Properties

P1 single winner · P2 money integrity · P3 match payout consistency · P4 one pending proposal (partial unique index) · P5 strictly increasing sequence · P6 terminal immutability · P7 authorization · P8 offer-state gate · P9 idempotency · P10 match supersession · P11 deviation reference stability.
