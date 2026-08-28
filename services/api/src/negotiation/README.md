# Negotiation Module

## Purpose

Manages price negotiation between a Host and a Cleaner over a published offer. A single negotiation thread exists per (offer, host, cleaner) combination and holds an ordered sequence of proposals authored by either actor. Each proposal proposes a price, which is validated against deviation bounds relative to the offer's immutable Base Price and priced using the offer's snapshotted commission rates. The module reuses the offers module's `CommissionService` for all money math (integer-only, no independent commission algorithm) and mirrors the offer state machine pattern for proposal lifecycle transitions.

## Files

| File | Responsibility |
|------|---------------|
| `negotiation.service.ts` | Orchestration layer for every negotiation mutation (accept offer, create counteroffer, accept/reject/counter proposal) and the read models (Cleaner thread, Host inbox). Coordinates idempotency → authorization + offer-state gate + delivery revalidation → atomic DB mutation → match via `OFFER_MATCH` → best-effort real-time publish. Never writes the `offers` table directly |
| `negotiation.types.ts` | Domain enums (`ProposalActor`, `ProposalStatus`, `SupersededReason`, `ThreadStatus`, `NegotiationOperation`) and view/summary interfaces returned by the service layer |
| `negotiation.constants.ts` | Environment-derived configuration (deviation bounds, response window, max proposals, sweep intervals), Centrifugo channel builders, and startup config validation |
| `negotiation.messages.ts` | Centralized server-side error messages (`NEGOTIATION_ERROR_MESSAGES`) so error strings are not scattered as literals; the mobile app maps HTTP outcomes to its own i18n keys |
| `negotiation-idempotency.service.ts` | `runOnce(userId, operation, key, work)` at-most-once wrapper backing Correctness Property P9: replays return the cached result and never create a duplicate proposal or second match, protected by a unique constraint on (user_id, operation, idempotency_key) |
| `proposal-state-machine.ts` | Pure proposal transition validation: allowed transitions map, terminal-status detection, `validateProposalTransition()` |
| `__tests__/proposal-state-machine.spec.ts` | Unit + property-based tests (fast-check) for the proposal state machine: allowed transitions from PENDING, transition table agreement, and Correctness Property P6 (Terminal Immutability — no transition out of any terminal status) |
| `negotiation.repository.ts` | Data-access layer for `negotiation_threads` and `negotiation_proposals`. Owns all reads/writes via parameterized SQL, including the `SELECT ... FOR UPDATE` transaction that allocates a monotonic sequence/version on proposal insert. Never writes the `offers` table (matching goes through the `OFFER_MATCH` contract) |
| `pricing/negotiation-pricing.service.ts` | Computes proposal commission breakdown (delegating to offers `CommissionService`) and enforces deviation bounds against the immutable Base Price |
| `expiration/proposal-expiry.worker.ts` | Scheduled `@Interval` worker that periodically marks PENDING proposals past their response window as `EXPIRED` (distinct from `SUPERSEDED`); the offer stays ACTIVE so the Cleaner may re-counter. Sweep interval from `NEGOTIATION_EXPIRY_SWEEP_MS` |
| `reconciliation/negotiation-reconciliation.service.ts` | Scheduled `@Interval` safety-net sweep (second line of defense behind `OfferTerminalListener`) that supersedes PENDING proposals left on terminal offers and closes their threads, making post-match state eventually consistent. Interval from `NEGOTIATION_RECONCILE_INTERVAL_MS` |
| `entities/negotiation-thread.entity.ts` | TypeORM entity for `negotiation_threads` (one per offer/host/cleaner, current-proposal pointer, monotonic version, base price snapshot) |
| `entities/negotiation-proposal.entity.ts` | TypeORM entity for `negotiation_proposals` (actor, sequence, prices, status, supersession reason, expiry) |
| `events/negotiation-events.ts` | Real-time event name constants (`NEGOTIATION_EVENT_NAMES`), the `NegotiationEvent` envelope published to Centrifugo (carries `version`/`sequenceNumber` for ordering and `eventId` for dedup), and the `OfferStatusChangedEvent` schema consumed from offer-radar |
| `events/negotiation-publisher.service.ts` | Wraps Centrifugo publishing for negotiation events (proposal created/countered/rejected/accepted, offer-matched fan-out to other Cleaners). Transport-only, best-effort; attaches the Cleaner identity summary to the Host channel only |
| `__tests__/negotiation-publisher.service.spec.ts` | Unit tests for `NegotiationPublisher` channel scoping and the privacy boundary: proposal events reach only the intended Host/Cleaner channel, the `offer_status_changed{MATCHED}` fan-out targets other Cleaners' radar channels without leaking winner identity, and publish/broadcast failures are swallowed (best-effort contract) |
| `dto/create-counteroffer.dto.ts` | Request DTO for a Cleaner counteroffer (`proposedPriceCents`) |
| `dto/host-counter.dto.ts` | Request DTO for a Host counter-back (`proposedPriceCents`) |

## Database

### Tables
| Table | Description |
|-------|-------------|
| `negotiation_threads` | One thread per (offer, host, cleaner). Holds current PENDING proposal pointer, proposal count, monotonic version for event ordering, and the immutable `base_price_cents` deviation reference |
| `negotiation_proposals` | Generic proposals (actor = CLEANER or HOST) with sequence number, proposed price, derived Cleaner payout / Host total, status, supersession reason, and expiry |

### Entities
| Entity | File | Description |
|--------|------|-------------|
| `NegotiationThread` | `entities/negotiation-thread.entity.ts` | Thread aggregate with `OneToMany` proposals relation and base price snapshot |
| `NegotiationProposal` | `entities/negotiation-proposal.entity.ts` | Proposal with `ManyToOne` thread relation (CASCADE delete) |

### Key Constraints
- `uq_negotiation_thread` — one thread per (offerId, hostId, cleanerId)
- `chk_thread_status` — thread status in (OPEN, CLOSED)
- `chk_thread_base_price` — base_price_cents > 0
- `uq_proposal_thread_sequence` — unique (threadId, sequenceNumber)
- `chk_proposal_actor` — actor in (CLEANER, HOST)
- `chk_proposal_status` — status in (PENDING, ACCEPTED, REJECTED, COUNTERED, SUPERSEDED, EXPIRED)
- `chk_proposal_superseded_reason` — superseded_reason NULL or in (OFFER_MATCHED, OFFER_CANCELLED, OFFER_EXPIRED, DIRECT_ACCEPT)
- `chk_proposal_price_positive` — proposed_price_cents > 0

## Orchestration & Operations

`NegotiationService` is the single entry point for negotiation mutations. Every mutation runs through `NegotiationIdempotencyService.runOnce(...)` and follows the same pipeline: idempotency check → authorization + offer-state gate + delivery revalidation → atomic DB mutation → match via the `OFFER_MATCH` contract when accepting → best-effort real-time publish. The service never writes the `offers` table directly; the `ACTIVE → MATCHED` transition happens exclusively through `OFFER_MATCH`. On a successful match it marks only the winning proposal `ACCEPTED`; superseding the other `PENDING` proposals is delegated to `OfferTerminalListener` reacting to `offer.matched`.

| Operation | Actor | Effect |
|-----------|-------|--------|
| `acceptOffer` | Cleaner | Direct accept at the Host's Base Price: match via contract, supersede the Cleaner's own open counteroffer (`DIRECT_ACCEPT`), publish |
| `createCounteroffer` | Cleaner | Validate deviation bounds + proposal budget, insert a PENDING `CLEANER` proposal, publish to the Host channel |
| `acceptProposal` | Counterparty | Authorize counterparty, mark proposal `ACCEPTED`, match via contract, publish |
| `rejectProposal` | Counterparty | Mark proposal `REJECTED` (offer stays `ACTIVE`), notify the proposal's author |
| `counterProposal` | Counterparty | Mark prior proposal `COUNTERED`, insert a new PENDING proposal by the countering actor, notify the counterparty |
| `getThreadForCleaner` | Cleaner | Read the Cleaner's own thread with ordered proposals |
| `getHostInbox` | Host | Read PENDING Cleaner counteroffers across the Host's ACTIVE offers |

Authorization rule: only the counterparty may act on a proposal — a Host acts on `CLEANER` proposals, a Cleaner acts on `HOST` proposals, never their own.

## Data Access

`NegotiationRepository` is the single owner of all reads and writes to `negotiation_threads` and `negotiation_proposals`. It uses parameterized SQL exclusively (no string concatenation) and keeps money math out of its scope — payouts arrive pre-computed from `NegotiationPricingService`.

Key operations:

| Method | Responsibility |
|--------|---------------|
| `getOrCreateThread(...)` | Idempotently returns the single thread per (offer, host, cleaner), snapshotting the immutable base price at creation |
| `insertProposalLocked(...)` | Locks the thread row with `SELECT ... FOR UPDATE`, allocates `sequence_number = proposal_count + 1`, bumps `proposal_count`/`version`, inserts the PENDING proposal, and moves the `current_proposal_id` pointer — all in one transaction |
| `markProposalCountered` / `setProposalStatus` / `markProposalAccepted` | Guarded status transitions that only affect rows still in `PENDING` |
| `supersedePendingForOffer` / `closeThreadsForOffer` | Bulk terminal transitions when an offer becomes matched/cancelled/expired (idempotent) |
| `expireStalePendingProposals` | Sweep that expires PENDING proposals past their response window; returns the affected count |
| `findHostInbox` | Read model of PENDING Cleaner-authored proposals across the Host's ACTIVE offers |
| `findThreadsNeedingReconciliation` | Detects PENDING proposals left behind on terminal offers for the reconciliation sweep |

Concurrency guarantee: the `SELECT ... FOR UPDATE` lock plus the `uq_proposal_thread_sequence` unique index serialize concurrent inserts so at most one PENDING proposal exists per thread and sequence numbers never collide.

## Background Workers

Two scheduled sweeps run on `@nestjs/schedule` `@Interval` timers (same pattern as `EmailVerificationSyncService`). Both are idempotent and retry-safe, log-and-continue on failure, and delegate all DB work to `NegotiationRepository`.

| Worker | Interval | Responsibility |
|--------|----------|---------------|
| `ProposalExpiryWorker.sweep` | `NEGOTIATION_EXPIRY_SWEEP_MS` (default 60s) | Marks PENDING proposals past their response window as `EXPIRED`. The offer stays ACTIVE so the Cleaner may submit a new counteroffer |
| `NegotiationReconciliationService.reconcile` | `NEGOTIATION_RECONCILE_INTERVAL_MS` (default 120s) | Safety net behind `OfferTerminalListener`: supersedes PENDING proposals stranded on terminal (MATCHED/CANCELLED/EXPIRED) offers and closes their threads, without a distributed transaction |

## Proposal State Machine

Only `PENDING` is non-terminal. Every other status is terminal (no further transitions).

```
PENDING → ACCEPTED
PENDING → REJECTED
PENDING → COUNTERED
PENDING → SUPERSEDED
PENDING → EXPIRED
```

## Pricing & Deviation Bounds

`NegotiationPricingService` is a thin wrapper over the offers `CommissionService`. It never implements an independent commission or rounding algorithm — every proposal reuses the offer's snapshotted rate basis points and integer-only `Math.trunc` rounding.

- `computeBreakdown(offer, proposedPriceCents)` — full payout / host-total breakdown using the offer's snapshotted rate bps
- `getDeviationRange(basePriceCents)` — inclusive `[min, max]` allowed price range, always relative to the immutable Base Price
- `isWithinDeviationBounds(basePriceCents, proposedPriceCents)` — bounds check

Deviation is always evaluated against the immutable Base Price (never a prior proposal).

## Dependencies

### Internal Modules
- **Offers module** — `CommissionService` (all proposal money math), `Offer` entity, `CommissionBreakdown` type, and the `OFFER_MATCH` contract used when a proposal is accepted

### External Services
- **PostgreSQL** — source of truth for threads and proposals
- **Redis + BullMQ** — proposal expiry sweep and reconciliation sweep
- **Centrifugo** — real-time proposal events to Host and Cleaner channels (transport only)

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NEGOTIATION_MIN_DEVIATION_BPS` | Max downward deviation from Base Price in bps (default: 2000 = 20%) | No |
| `NEGOTIATION_MAX_DEVIATION_BPS` | Max upward deviation from Base Price in bps (default: 2000 = 20%) | No |
| `NEGOTIATION_RESPONSE_WINDOW_MS` | PENDING proposal response window in ms (default: 900000 = 15 min) | No |
| `NEGOTIATION_MAX_PROPOSALS` | Max proposals per thread, including terminal ones (default: 6) | No |
| `NEGOTIATION_EXPIRY_SWEEP_MS` | Proposal expiration sweep interval in ms (default: 60000) | No |
| `NEGOTIATION_RECONCILE_INTERVAL_MS` | Reconciliation sweep interval in ms (default: 120000) | No |

All values are validated at startup by `validateNegotiationConfig()` (fail-fast).

## Real-time Channels

Defined in `NEGOTIATION_CHANNELS` (`negotiation.constants.ts`):

| Channel | Purpose |
|---------|---------|
| `negotiation:host:{hostId}` | Proposal events for the Host |
| `negotiation:cleaner:{cleanerId}` | Proposal events for the Cleaner |
| `offers:cleaner:{cleanerId}` | Existing radar channel — clears pins on other Cleaners when an offer is matched |

### Event Names

Event name constants and the `NegotiationEvent` envelope are defined in `events/negotiation-events.ts`. The Cleaner identity summary is attached ONLY on the Host channel — it is never leaked to Cleaners who did not win the offer.

| Event | Emitted when |
|-------|--------------|
| `negotiation_proposal_created` | A new proposal is added to a thread |
| `negotiation_proposal_countered` | A proposal is countered by the other actor |
| `negotiation_proposal_rejected` | A pending proposal is rejected |
| `negotiation_proposal_accepted` | A proposal is accepted (triggers the `OFFER_MATCH` contract) |

Every event carries a monotonic `version` (thread version after the mutation) and `sequenceNumber` so clients discard out-of-order events, plus an `eventId` (UUID) for client-side dedup and trace correlation.
