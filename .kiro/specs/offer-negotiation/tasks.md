# Implementation Plan: Offer Negotiation

## Overview

Offer Negotiation finalizes the match between a Host and a Cleaner. Implementation follows a bottom-up approach: database schema first (negotiation_threads, negotiation_proposals, negotiation_idempotency), then the proposal state machine + pricing wrapper, then the service/repository orchestration, then the controller + guards, then real-time publisher + terminal-state listener + reconciliation/expiration workers, and finally the mobile store, screens, and Quick Accept wiring into offer-radar. The module lives in its own `NegotiationModule` importing `OffersModule` to consume the `OFFER_MATCH` contract and `CommissionService`. It NEVER writes the `offers` table directly; ACTIVE -> MATCHED happens exclusively through the contract. All money math reuses CommissionService; all mutations are idempotent; deviation bounds are always evaluated against the immutable Base Price.

## Tasks

- [x] 1. Backend — Database Schema & Migration
  - [x] 1.1 Create the negotiation migration
    - Create `services/api/src/migrations/1700000020000-CreateNegotiationTables.ts` implementing `MigrationInterface` with `up()`/`down()`
    - Table `negotiation_threads`: id UUID PK, offer_id (FK offers ON DELETE CASCADE), host_id (FK users ON DELETE RESTRICT), cleaner_id (FK users ON DELETE RESTRICT), status VARCHAR(20) DEFAULT OPEN, current_proposal_id UUID nullable, proposal_count INTEGER DEFAULT 0, version INTEGER DEFAULT 0, base_price_cents INTEGER NOT NULL, currency CHAR(3), created_at/updated_at TIMESTAMPTZ
    - Constraints: `uq_negotiation_thread UNIQUE (offer_id, host_id, cleaner_id)`, `chk_thread_status CHECK (status IN (OPEN, CLOSED))`; indexes on offer_id, host_id, cleaner_id
    - Table `negotiation_proposals`: id UUID PK, thread_id (FK ON DELETE CASCADE), actor VARCHAR(10), sequence_number INTEGER, proposed_price_cents INTEGER, cleaner_payout_cents INTEGER, host_total_cents INTEGER, currency CHAR(3), status VARCHAR(12) DEFAULT PENDING, superseded_reason VARCHAR(20) nullable, expires_at TIMESTAMPTZ NOT NULL, responded_at TIMESTAMPTZ nullable, created_at/updated_at TIMESTAMPTZ
    - Constraints: `chk_proposal_actor`, `chk_proposal_status`, `chk_proposal_price_positive (proposed_price_cents > 0)`, `uq_proposal_thread_sequence UNIQUE (thread_id, sequence_number)`
    - Partial unique index `uq_one_pending_per_thread ON negotiation_proposals (thread_id) WHERE status = PENDING` (Correctness Property P4)
    - Indexes: thread_id, status, `idx_negotiation_proposals_expiry (expires_at) WHERE status = PENDING`
    - Table `negotiation_idempotency`: id UUID PK, user_id UUID, operation VARCHAR(50), idempotency_key VARCHAR(255), result_json JSONB, created_at TIMESTAMPTZ, `uq_negotiation_idempotency UNIQUE (user_id, operation, idempotency_key)`
    - `down()` drops indexes then tables in reverse dependency order
    - _Requirements: 3.5, 3.8, 6.1, 8.1_

- [x] 2. Backend — Types, Constants & State Machine
  - [x] 2.1 Create negotiation types and enums
    - Create `services/api/src/negotiation/negotiation.types.ts` with enums `ProposalActor` (CLEANER, HOST), `ProposalStatus` (PENDING, ACCEPTED, REJECTED, COUNTERED, SUPERSEDED, EXPIRED), `SupersededReason` (OFFER_MATCHED, OFFER_CANCELLED, OFFER_EXPIRED, DIRECT_ACCEPT), `ThreadStatus` (OPEN, CLOSED)
    - Add internal types: `MatchSummary`, `ProposalView`, `ThreadView`, `HostInboxItem`
    - _Requirements: 8.5_

  - [x] 2.2 Create negotiation constants with startup validation
    - Create `services/api/src/negotiation/negotiation.constants.ts` with env-configurable values: `NEGOTIATION_MIN_DEVIATION_BPS` (2000), `NEGOTIATION_MAX_DEVIATION_BPS` (2000), `NEGOTIATION_RESPONSE_WINDOW_MS` (900000), `NEGOTIATION_MAX_PROPOSALS_PER_THREAD` (6), `NEGOTIATION_EXPIRY_SWEEP_INTERVAL_MS` (60000), `NEGOTIATION_RECONCILE_INTERVAL_MS` (120000), and `NEGOTIATION_CHANNELS` helpers
    - Implement fail-fast startup validation: 0 <= MIN/MAX deviation bps <= 10000; response window, max proposals, sweep intervals all > 0
    - No hardcoded business values anywhere in logic
    - _Requirements: 3.3, 3.9, 8.3_

  - [x] 2.3 Implement the proposal state machine (pure)
    - Create `services/api/src/negotiation/proposal-state-machine.ts` with `PROPOSAL_ALLOWED_TRANSITIONS` (only PENDING is non-terminal), `TERMINAL_PROPOSAL_STATUSES`, and a pure `validateProposalTransition(from, to)` function mirroring offer-publishing's `validateTransition`
    - _Requirements: 8.5_

  - [x]* 2.4 Write unit tests for the proposal state machine
    - Test every allowed transition from PENDING succeeds
    - Test every terminal status rejects all further transitions (Property P6)
    - _Requirements: 8.5_

- [x] 3. Backend — Entities & Pricing
  - [x] 3.1 Create TypeORM entities
    - Create `entities/negotiation-thread.entity.ts` and `entities/negotiation-proposal.entity.ts` matching the migration columns, constraints, and relations (thread OneToMany proposals; proposal ManyToOne thread)
    - JSDoc on every column explaining meaning and nullability
    - Directory: `services/api/src/negotiation/entities/`
    - _Requirements: 6.1_

  - [x] 3.2 Implement NegotiationPricingService
    - Create `pricing/negotiation-pricing.service.ts` wrapping `CommissionService.getFullBreakdown(priceCents, offer.hostServiceFeeRateBps, offer.cleanerCommissionRateBps)`
    - Reuse the offer's snapshotted rate bps; NEVER implement an independent commission/rounding algorithm
    - Add `isWithinDeviationBounds(basePriceCents, proposedPriceCents)` using integer Math.trunc bps math against the Base Price
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 3.3_

  - [x]* 3.3 Write unit tests for pricing and deviation bounds
    - Test payout/host-total equal CommissionService breakdown for arbitrary prices (Property P2, P3)
    - Test deviation bounds computed against Base Price, inclusive edges (Property P11)
    - Test price equal to Base Price yields the original breakdown
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 3.3_

- [x] 4. Backend — Repository (atomic writes)
  - [x] 4.1 Implement NegotiationRepository
    - Create `negotiation.repository.ts` with: find/create thread for (offer, host, cleaner); `SELECT ... FOR UPDATE` on the thread row before allocating `sequence_number = proposal_count + 1` and bumping `proposal_count`/`version` in the same transaction
    - Insert proposal PENDING (partial unique index guards single PENDING); set prior proposal COUNTERED; mark winning proposal ACCEPTED; supersede PENDING proposals for an offer with a given reason (idempotent `WHERE status = PENDING`)
    - Idempotency helpers: read cached result by (user_id, operation, key); persist result
    - Queries: cleaner thread for offer; host inbox (PENDING CLEANER-actor proposals across host's ACTIVE offers)
    - _Requirements: 2.4, 3.5, 3.8, 4.1_

  - [x]* 4.2 Write unit tests for repository sequence/version allocation
    - Test sequence_number strictly increasing under serialized transactions (Property P5)
    - Test proposal_count counts terminal proposals (no budget reset)
    - Test supersede is idempotent (only PENDING affected)
    - _Requirements: 3.5, 2.4_

- [x] 5. Backend — Real-Time Publisher & Events
  - [x] 5.1 Implement negotiation events and publisher
    - Create `events/negotiation-events.ts` with event name constants (`negotiation_proposal_created`, `_countered`, `_rejected`, `_accepted`) and the `NegotiationEvent` envelope interface (eventId UUID, type, threadId, proposalId, offerId, version, sequenceNumber, occurredAt)
    - Create `events/negotiation-publisher.service.ts` using `CentrifugoClient.publish`/`broadcast`
    - Channel scoping: `negotiation:host:{hostId}`, `negotiation:cleaner:{cleanerId}`; on match also publish `offer_status_changed { state: MATCHED }` to other Cleaners' `offers:cleaner:{cleanerId}` channels
    - Never leak the winning Cleaner identity or negotiation detail to losing Cleaners; publish failures logged, never rolled back
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_

  - [x]* 5.2 Write unit tests for publisher channel scoping
    - Test Host events go only to the host channel; Cleaner events only to that cleaner's channel
    - Test losing Cleaners receive only offer_status_changed{MATCHED} with no winner identity (Property P7 privacy boundary)
    - Test event envelope includes eventId + version
    - _Requirements: 7.7, 7.8_

- [x] 6. Checkpoint — Backend foundation compiles and unit tests pass
  - Ensure schema, state machine, pricing, repository, and publisher tests pass; ask the user if questions arise.

- [x] 7. Backend — NegotiationService (orchestration)
  - [x] 7.1 Implement direct acceptance and single-winner match
    - Create `negotiation.service.ts` `acceptOffer(cleanerId, offerId, idempotencyKey)`: idempotency check -> assert offer ACTIVE + Cleaner has SENT delivery -> `OfferMatchContract.match(offerId, cleanerId, 'negotiation')`
    - On contract success: mark the winning proposal ACCEPTED (or synth a direct-accept record) + persist agreed price/breakdown; publish accepted + offer_status_changed{MATCHED}; supersede the Cleaner's own PENDING proposal with reason DIRECT_ACCEPT
    - On contract failure (offer not ACTIVE): return 409 conflict
    - Cache idempotent result
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.1, 2.2, 2.3_

  - [x] 7.2 Implement counteroffer submission
    - `createCounteroffer(cleanerId, offerId, dto, key)`: revalidate ACTIVE + SENT delivery; validate price is positive integer within Base Price deviation bounds; create/reuse thread; insert PENDING proposal with sequence + expires_at = now + response window; compute payout via pricing service
    - Reject second concurrent PENDING (partial unique -> 409); reject when max proposals reached (422)
    - Publish `negotiation_proposal_created` to Host channel
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

  - [x] 7.3 Implement host review actions (accept / reject / counter-back)
    - `acceptProposal(userId, proposalId, key)`: authorize counterparty rule (Host accepts CLEANER proposal; never own actor); revalidate offer ACTIVE + proposal PENDING; mark ACCEPTED + match via contract + publish; other PENDING superseded by listener
    - `rejectProposal(userId, proposalId, key)`: set REJECTED, leave offer ACTIVE, publish `negotiation_proposal_rejected`
    - `counterProposal(userId, proposalId, dto, key)`: set prior proposal COUNTERED; insert new HOST-actor PENDING with next sequence + own expires_at; validate against Base Price bounds; publish `negotiation_proposal_countered`
    - Forbidden if not offer owner (403); conflict if proposal not PENDING (409)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 7.4 Implement thread and inbox reads
    - `getThreadForCleaner(cleanerId, offerId)`: return the cleaner's thread with ordered proposals + payout breakdowns
    - `getHostInbox(hostId)`: return PENDING CLEANER-actor proposals across the host's ACTIVE offers, grouped by offer, with Cleaner summary
    - _Requirements: 4.1, 10.4, 11.1_

  - [x]* 7.5 Write unit tests for NegotiationService orchestration
    - Test accept success/conflict branches; single-winner via mocked contract (Property P1)
    - Test offer-state gate rejects non-ACTIVE (Property P8); authorization rejects wrong role / non-owner / own-proposal accept (Property P7)
    - Test idempotent replay returns cached result, no duplicate proposal/match (Property P9)
    - Test deviation-bound rejection; max-proposals limit
    - _Requirements: 1.1, 2.1, 3.3, 4.7, 8.2, 1.7_

- [x] 8. Backend — Controller & Guards
  - [x] 8.1 Implement NegotiationController
    - Create `negotiation.controller.ts` class-level `@UseGuards(JwtAuthGuard)`; resolve keycloakId -> User; assert Cleaner/Host role per endpoint (mirror OffersController)
    - Endpoints: POST `/negotiation/offers/:offerId/accept` (Cleaner), POST `/negotiation/offers/:offerId/counteroffers` (Cleaner), POST `/negotiation/proposals/:proposalId/accept|reject|counter` (Host or Cleaner counterparty), GET `/negotiation/offers/:offerId/thread` (Cleaner), GET `/negotiation/host/counteroffers` (Host)
    - Require `Idempotency-Key` header on all mutations; 400 if missing/empty
    - DTO validation via ValidationPipe (whitelist, forbidNonWhitelisted); status codes 200/201/400/401/403/409/422
    - Add Swagger/OpenAPI decorators
    - _Requirements: 1.1, 3.1, 4.1, 4.7, 5.1_

  - [x] 8.2 Create request DTOs
    - Create `dto/create-counteroffer.dto.ts` (proposedPriceCents int positive), `dto/host-counter.dto.ts` (proposedPriceCents), `dto/respond-proposal.dto.ts`, `dto/negotiation-response.dto.ts` with class-validator/class-transformer decorators
    - Directory: `services/api/src/negotiation/dto/`
    - _Requirements: 3.2, 4.5_

  - [x]* 8.3 Write unit tests for the controller
    - Test JWT/role rejection; missing Idempotency-Key -> 400
    - Test counterparty authorization invariant (cannot accept own proposal)
    - Test DTO validation rejects non-positive prices
    - _Requirements: 4.7, 3.2_

- [x] 9. Backend — Listener, Reconciliation & Expiration
  - [x] 9.1 Implement OfferTerminalListener (single supersession authority)
    - Create `listeners/offer-terminal.listener.ts` subscribing (EventEmitter2) to `offer.cancelled`, `offer.expired`, `offer.matched`
    - Supersede all PENDING proposals for the offer with the mapped reason (OFFER_CANCELLED/OFFER_EXPIRED/OFFER_MATCHED) and set thread(s) status = CLOSED
    - The winning proposal (already ACCEPTED by the service) is not PENDING and is untouched
    - _Requirements: 2.4, 8.1, 8.2, 10.4_

  - [x] 9.2 Implement NegotiationReconciliationService
    - Create `reconciliation/negotiation-reconciliation.service.ts` running on `NEGOTIATION_RECONCILE_INTERVAL_MS`
    - Repair partial states: offer MATCHED but proposal still PENDING -> supersede + ensure winner ACCEPTED + close thread; offer CANCELLED/EXPIRED with lingering PENDING -> supersede + close; thread OPEN while offer terminal -> close; re-publish offer_status_changed{MATCHED} if delivery previously failed
    - No distributed transactions; makes post-match state eventually consistent
    - _Requirements: 2.4, 7.9, 8.1_

  - [x] 9.3 Implement proposal expiration worker
    - Create `expiration/proposal-expiry.worker.ts` running on `NEGOTIATION_EXPIRY_SWEEP_INTERVAL_MS`
    - Mark PENDING proposals with `expires_at < NOW()` as EXPIRED (distinct from SUPERSEDED), using the expiry partial index; thread stays OPEN if offer still ACTIVE
    - _Requirements: 8.3, 8.4, 5.4_

  - [x] 9.4 Wire NegotiationModule
    - Create `negotiation.module.ts` importing `OffersModule` (inject `OFFER_MATCH` + `CommissionService`) and TypeOrmModule for the new entities
    - Register controller, service, repository, pricing, publisher, listener, reconciliation, expiration worker; register in the app module
    - _Requirements: 1.4, 6.2_

  - [x]* 9.5 Write unit tests for listener and reconciliation
    - Test listener supersedes PENDING + closes thread for each terminal event (Property P10)
    - Test reconciliation repairs offer-MATCHED-but-proposal-PENDING
    - _Requirements: 2.4, 8.1_

- [x] 10. Checkpoint — Backend negotiation flows work end-to-end
  - Ensure all backend tests pass; ask the user if questions arise.

- [x] 11. Mobile — Store, Types & API Client
  - [x] 11.1 Create negotiation types and constants
    - Create `apps/mobile/src/screens/negotiation/negotiation.types.ts` (ProposalStatus, ProposalActor, ThreadView, ProposalView, HostInboxItem, NegotiationEvent, Breakdown) and `negotiation.constants.ts` (deviation bps mirror, i18n keys, ENDPOINTS)
    - _Requirements: 10.5, 11.5_

  - [x] 11.2 Implement negotiation API client
    - Create `negotiation.api.ts` with lazy `getApiClient()`, `ENDPOINTS` map, and typed methods for accept/counteroffer/accept-proposal/reject/counter/thread/inbox; attach `Idempotency-Key` via `expo-crypto`
    - _Requirements: 1.7, 4.9, 5.5_

  - [x] 11.3 Implement useNegotiation Zustand store
    - Create `useNegotiation.ts` following useOffers/useRadarStore patterns
    - Cleaner actions: acceptOffer (direct), submitCounteroffer, acceptHostCounter, declineHostCounter
    - Host actions: fetchInbox, acceptCounteroffer, rejectCounteroffer, counterBack
    - Real-time `handleNegotiationEvent` (idempotent, gated by version/sequenceNumber + eventId dedup)
    - Derived preview: computePreviewPayout, isWithinDeviationBounds (mirror bounds; server authoritative)
    - i18n error keys; optimistic updates with rollback on failure
    - _Requirements: 6.1, 7.6, 10.2, 10.4, 11.5_

  - [x]* 11.4 Write unit tests for useNegotiation
    - Test idempotent + version-gated event handling (out-of-order discarded, duplicate eventId ignored)
    - Test deviation-bounds mirror matches server rule
    - Test preview payout equals server breakdown shape
    - _Requirements: 7.6, 10.2_

- [x] 12. Mobile — Cleaner Negotiation UI
  - [x] 12.1 Implement AcceptBar and CounterofferInput
    - Create `components/AcceptBar.tsx` (Accept at Host price; disabled when offline) and `components/CounterofferInput.tsx` (price entry + live payout via PayoutPreview + bounds guard showing allowed range)
    - _Requirements: 10.1, 10.2, 10.3, 9.2_

  - [x] 12.2 Implement PayoutPreview and ProposalStatusBadge
    - Create `components/PayoutPreview.tsx` (locale + currency formatted breakdown) and `components/ProposalStatusBadge.tsx`
    - _Requirements: 10.2, 10.4, 10.5_

  - [x] 12.3 Implement CleanerNegotiationScreen
    - Create `CleanerNegotiationScreen.tsx` assembling accept/counteroffer actions, live payout, PENDING status tracking, and Host response display
    - Allow Direct Accept while a PENDING counteroffer exists, communicating it supersedes the open counteroffer
    - All text via i18n keys; prices per locale + offer currency
    - _Requirements: 10.1, 10.4, 10.5, 10.6_

- [x] 13. Mobile — Host Negotiation UI
  - [x] 13.1 Implement HostCounterofferCard and CounterBackInput
    - Create `components/HostCounterofferCard.tsx` (proposed price, resulting Host total, Cleaner summary, Accept/Reject/Counter actions) and `components/CounterBackInput.tsx` (counter-back price + resulting Host total/Cleaner payout + Base Price bounds guard)
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 13.2 Implement HostCounterofferInboxScreen
    - Create `HostCounterofferInboxScreen.tsx` with counteroffers grouped by offer, real-time updates ordered by event version/sequence, and match/removal on accept
    - _Requirements: 11.1, 11.4, 11.5_

- [x] 14. Mobile — Quick Accept Wiring (offer-radar)
  - [x] 14.1 Wire OfferPreviewSheet Quick Accept to negotiation
    - Update `apps/mobile/src/screens/radar/components/OfferPreviewSheet.tsx` `handleQuickAccept` to call `useNegotiation().acceptOffer(offerId)` (replace the OfferDetail navigation placeholder)
    - Keep disabled when `connectionStatus === 'disconnected'`
    - On success -> remove offer from radar store + matched confirmation; on 409 -> non-blocking toast + remove stale offer; no client-side eligibility logic
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x]* 14.2 Write component tests for Quick Accept wiring
    - Test Quick Accept disabled when offline
    - Test success removes offer from radar; 409 removes stale offer with toast
    - _Requirements: 9.2, 9.3, 9.4_

- [x] 15. Checkpoint — Full negotiation UX integrated
  - Ensure mobile + backend integration works; ask the user if questions arise.

- [x] 16. Property-Based Tests (fast-check)
  - [x]* 16.1 Property test: Single Winner
    - **Property 1: Single Winner**
    - **Validates: Requirements 2.1, 2.2, 2.3**
    - Generate concurrent acceptance attempts on one offer with a mocked contract lock
    - Assert at most one attempt reaches MATCHED; all others get conflict

  - [x]* 16.2 Property test: Money Integrity
    - **Property 2: Money Integrity**
    - **Validates: Requirements 6.1, 6.2**
    - Generate random prices; assert payout/host-total come only from CommissionService (integer arithmetic, no float)

  - [x]* 16.3 Property test: Match Payout Consistency
    - **Property 3: Match Payout Consistency**
    - **Validates: Requirements 6.3, 6.4, 6.5**
    - Generate random agreed prices; assert persisted breakdown equals CommissionService.getFullBreakdown with the offer snapshotted rates

  - [x]* 16.4 Property test: One Pending Proposal
    - **Property 4: One Pending Proposal**
    - **Validates: Requirements 3.8**
    - Generate concurrent proposal inserts on one thread; assert at most one PENDING remains

  - [x]* 16.5 Property test: Proposal Ordering
    - **Property 5: Proposal Ordering**
    - **Validates: Requirements 3.5**
    - Generate a sequence of proposals; assert sequence_number strictly increasing, no duplicates

  - [x]* 16.6 Property test: Terminal Immutability
    - **Property 6: Terminal Immutability**
    - **Validates: Requirements 8.5**
    - Generate transition attempts from terminal statuses; assert all rejected

  - [x]* 16.7 Property test: Authorization
    - **Property 7: Authorization**
    - **Validates: Requirements 1.2, 1.3, 4.7**
    - Generate random actor/role combinations; assert only counterparty/owner actions succeed, never self-accept

  - [x]* 16.8 Property test: Offer State Gate
    - **Property 8: Offer State Gate**
    - **Validates: Requirements 1.1, 3.1, 8.2**
    - Generate offers in all states; assert mutations succeed only when ACTIVE

  - [x]* 16.9 Property test: Idempotency
    - **Property 9: Idempotency**
    - **Validates: Requirements 1.7, 4.9, 5.5**
    - Replay the same (user, operation, key); assert identical result and no duplicate proposal/match

  - [x]* 16.10 Property test: Match Supersession
    - **Property 10: Match Supersession**
    - **Validates: Requirements 2.4, 4.3**
    - Generate a matched offer with several PENDING proposals; assert all others SUPERSEDED, winner ACCEPTED

  - [x]* 16.11 Property test: Deviation Reference Stability
    - **Property 11: Deviation Reference Stability**
    - **Validates: Requirements 3.3, 4.6**
    - Generate a chain of proposals; assert each validated against the immutable Base Price, never a prior proposal

- [x] 17. Integration Tests
  - [x]* 17.1 Write integration test: direct accept flow
    - Cleaner with SENT delivery accepts an ACTIVE offer -> matched; verify contract invoked with source negotiation and winner proposal ACCEPTED
    - _Requirements: 1.1, 1.4, 2.1_

  - [x]* 17.2 Write integration test: counteroffer -> counter-back -> accept
    - Full negotiation thread; verify statuses (COUNTERED, PENDING, ACCEPTED) and payout consistency
    - _Requirements: 3.5, 4.5, 5.2, 6.3_

  - [x]* 17.3 Write integration test: single-winner under concurrency
    - Two Cleaners accept same offer; verify exactly one match, other gets 409
    - _Requirements: 2.1, 2.2_

  - [x]* 17.4 Write integration test: DB constraint enforcement
    - Verify partial unique PENDING per thread and thread uniqueness per (offer, host, cleaner)
    - _Requirements: 3.8_

  - [x]* 17.5 Write integration test: terminal-state supersession + idempotent replay
    - Cancel/expire an offer -> PENDING proposals SUPERSEDED, thread CLOSED; replay idempotent mutation returns cached result
    - _Requirements: 8.1, 1.7_

- [x] 18. Final Checkpoint — All tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the universal correctness properties (P1-P11) from the design document
- The negotiation module NEVER writes the `offers` table directly; ACTIVE -> MATCHED is exclusively via the `OFFER_MATCH` contract
- All payout/host-total math reuses `CommissionService` (no independent commission algorithm)
- Deviation bounds are always evaluated against the immutable Base Price (`offers.offered_price_cents`)
- At most one PENDING proposal per thread, enforced by a partial unique index
- `OfferTerminalListener` is the single authority for superseding PENDING proposals; `NegotiationService` only marks the winner ACCEPTED
- All mutations require an `Idempotency-Key` header, scoped by `(user_id, operation, key)`
- Threads close (`CLOSED`) only when the offer becomes terminal, not when a proposal expires
- All UI text uses i18n keys; prices formatted per locale + offer currency
- All configurable values come from environment variables or the constants file, validated at startup

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.2", "2.3", "11.1"] },
    { "id": 1, "tasks": ["2.4", "3.1", "3.2", "11.2"] },
    { "id": 2, "tasks": ["3.3", "4.1", "5.1", "11.3"] },
    { "id": 3, "tasks": ["4.2", "5.2", "7.1", "11.4"] },
    { "id": 4, "tasks": ["7.2", "7.3", "7.4"] },
    { "id": 5, "tasks": ["7.5", "8.1", "8.2"] },
    { "id": 6, "tasks": ["8.3", "9.1", "9.2", "9.3", "9.4"] },
    { "id": 7, "tasks": ["9.5", "12.1", "12.2", "13.1"] },
    { "id": 8, "tasks": ["12.3", "13.2", "14.1"] },
    { "id": 9, "tasks": ["14.2", "16.1", "16.2", "16.3", "16.4", "16.5", "16.6", "16.7", "16.8", "16.9", "16.10", "16.11"] },
    { "id": 10, "tasks": ["17.1", "17.2", "17.3", "17.4", "17.5"] }
  ]
}
```