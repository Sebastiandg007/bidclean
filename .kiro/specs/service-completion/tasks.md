# Implementation Plan: Service Completion

## Overview

`service-completion` (Spec 20, the last of Sprint 5 — Service Execution) closes the service loop. After the Cleaner finalizes the checklist (Spec 19 emits the durable `checklist_completed` fact, now carrying `completedAt` — the authoritative finish time), the Host either **confirms satisfaction** (releasing the escrowed payment to the Cleaner), does nothing (an **auto-release** fires after the snapshotted 24h window), or **opens a dispute** (routed to Spec 21, which pauses auto-release). A mutual **rating** is captured at the end but never gates release. It is **not a new money domain** — it composes patterns already proven in the sibling specs: it owns the completion DECISION and durably enqueues the release intent; it never moves money.

This plan is bottom-up and builds incrementally: config/constants + fail-fast `validateServiceCompletionConfig()` + the schema migration (`service_completions`, `release_intents` with `dispatched_at`/`lease_until`, `service_ratings`, `completion_outbox`, all constraints/indexes/CHECKs from the design's Data Models) → entities + types → repositories (single-winner transition co-writing intent + outbox in one tx, `transitionPostReleaseDispute` with the `ACCEPTED` `EXISTS` gate, the release-intent lease claim, one-per-side ratings) → participation + creation services (idempotent `createFromChecklistCompleted` snapshotting the deadline from `completedAt`) → decision service (confirm/openDispute/openPostReleaseDispute, single-winner, Host-only, `409`-until-`ACCEPTED`) → auto-release service (single-winner sweep transition) → rating service (never gating) → the `checklist_completed` consumer (its own `consumer_name='completion'` checkpoint) → jobs (auto-release sweep + release-intent worker with lease claim + idempotent release) → controller + DTOs + module wiring (GET with derived `release_status`, `validateServiceCompletionConfig()` on boot) → checkpoint (backend) → mobile core (types, api, store, `useAutoReleaseCountdown` from the durable deadline) → mobile screens + i18n → checkpoint (mobile) → property-based (P1–P13), unit, DDL, integration, and mobile tests → docs. Everything is testable in CI (backend) and locally (mobile), with Stripe (`EscrowReleaseService`) a mocked seam — zero real external calls.

Scope: one completion per service session (`UNIQUE service_session_id`); the decision + the durable release intent (never the money ledger); server-authoritative snapshotted deadline; single-winner transitions; ratings captured not gating. See `requirements.md` (Req 1–8 + REQ-SC1…REQ-SC12) and `design.md` (Properties P1–P13).

## Tasks

- [ ] 1. Backend config, constants & schema
  - [ ] 1.1 Add service-completion env keys to `.env.example`
    - Add `SERVICE_AUTO_RELEASE_WINDOW_MS` (default `86400000` = 24h), `SERVICE_COMPLETION_SWEEP_INTERVAL_MS`, `SERVICE_COMPLETION_SWEEP_BATCH_SIZE`, `SERVICE_COMPLETION_RELEASE_INTENT_INTERVAL_MS`, `SERVICE_COMPLETION_RELEASE_INTENT_BATCH_SIZE`, `SERVICE_COMPLETION_RELEASE_INTENT_LEASE_MS` (the `DISPATCHED` claim lease; must be `> SERVICE_COMPLETION_RELEASE_INTENT_INTERVAL_MS`), `SERVICE_RATING_MIN_STARS` (default `1`), `SERVICE_RATING_MAX_STARS` (default `5`); document that **no Stripe keys are added by this spec** (money authority stays in Spec 9) and that the mobile auto-release countdown derives entirely from the server-returned durable deadline (no client-embedded window)
    - _Requirements: 7.1, 7.2, 7.3_
  - [ ] 1.2 Create service-completion constants with fail-fast validation
    - Create `services/api/src/service-completion/completion.constants.ts` (env-configurable values + queue names) and `config/validate-service-completion-config.ts`: parse all `SERVICE_*` values; `validateServiceCompletionConfig()` fail-fast at startup (skipped under `NODE_ENV=test`): `SERVICE_AUTO_RELEASE_WINDOW_MS > 0`; all sweep/intent interval + batch values `> 0`; `SERVICE_COMPLETION_RELEASE_INTENT_LEASE_MS > 0` AND `> SERVICE_COMPLETION_RELEASE_INTENT_INTERVAL_MS` (a lease shorter than the drain interval could let a concurrent pass reclaim a still-live dispatch); `1 <= SERVICE_RATING_MIN_STARS <= SERVICE_RATING_MAX_STARS <= 5`; no hardcoded values in logic
    - _Requirements: 7.1, 7.2, 7.3 · P13_
  - [ ] 1.3 Create the service-completion schema migration
    - Create `services/api/src/migrations/<timestamp>-CreateServiceCompletionTables.ts` (reversible `up()`/`down()`, `IF NOT EXISTS`, table/column comments; timestamp after the last Sprint-5 migration): (a) `service_completions` (`service_session_id` FK CASCADE **UNIQUE**; `offer_id` FK CASCADE indexed; `payment_id` UUID NOT NULL indexed, **no FK cascade from payments**; `host_id`/`cleaner_id` FK **SET NULL** indexed; `state VARCHAR(30) DEFAULT 'AWAITING_CONFIRMATION'` CHECK `AWAITING_CONFIRMATION/CONFIRMED/AUTO_RELEASED/DISPUTED`; `checklist_completed_at TIMESTAMPTZ NOT NULL`; `auto_release_deadline TIMESTAMPTZ NOT NULL`; `confirmed_at?`; `released_trigger VARCHAR(20)?` CHECK `HOST_CONFIRMED/AUTO_RELEASE`; `dispute_id?`; `post_release_dispute_id?`; `created_at`/`updated_at`; **no `deleted_at`**; the sweep partial index `idx_service_completions_due (auto_release_deadline) WHERE state='AWAITING_CONFIRMATION'`; FK indexes; the coherence `CHECK ((released_trigger IS NULL) = (state NOT IN ('CONFIRMED','AUTO_RELEASED')))`); (b) `release_intents` (`service_completion_id` FK **ON DELETE SET NULL** nullable indexed; `payment_id` NOT NULL indexed; `reason VARCHAR(20) NOT NULL` CHECK `HOST_CONFIRMED/AUTO_RELEASE`; `status VARCHAR(20) DEFAULT 'PENDING'` CHECK `PENDING/DISPATCHED/ACCEPTED/FAILED_RETRYABLE`; `attempt INTEGER DEFAULT 0`; `dispatched_at?`; `lease_until?`; `last_error TEXT?`; `created_at`/`updated_at`; `uq_release_intents_completion (service_completion_id)`; the drain/claim partial index `idx_release_intents_drain (created_at) WHERE status IN ('PENDING','FAILED_RETRYABLE','DISPATCHED')`); (c) `service_ratings` (`service_completion_id` FK **CASCADE** indexed; `rater_id`/`ratee_id` FK **SET NULL**; `role VARCHAR(20) NOT NULL` CHECK `HOST_RATES_CLEANER/CLEANER_RATES_HOST`; `stars SMALLINT NOT NULL` CHECK `(stars >= 1 AND stars <= 5)`; `comment TEXT?`; `created_at`; **no `deleted_at`**; `uq_service_ratings_completion_role (service_completion_id, role)`; FK indexes); (d) `completion_outbox` (`event_id VARCHAR(255) UNIQUE`, `aggregate_type DEFAULT 'service_completion'`, `aggregate_id`, `type`, `payload` JSONB, `version DEFAULT 1`, `created_at`; **no `relayed_at`**; `idx_completion_outbox_created`); `down()` drops in dependency order
    - _Requirements: 8.1, 8.2, 8.3, 8.4 · P1, P3, P4, P8, P12, P13_

- [ ] 2. Entities & types
  - [ ] 2.1 Create service-completion entities
    - Create `services/api/src/service-completion/entities/service-completion.entity.ts`, `release-intent.entity.ts`, `service-rating.entity.ts` (and a `completion-outbox` entity as needed) mirroring sibling conventions (timestamptz, snake_case, `@Unique`/`@Index` matching the migration, `CHECK`-backed `state`/`released_trigger`/intent `reason`/`status`/rating `role` unions, no `deleted_at`)
    - _Requirements: 8.1_
  - [ ] 2.2 Create completion domain types + error strings
    - Create `services/api/src/service-completion/completion.types.ts`: `ServiceCompletionView`/`ServiceCompletionSummary` (state, snapshotted `auto_release_deadline`, `released_trigger`, `confirmed_at`, `dispute_id`, `post_release_dispute_id`, derived `releaseStatus`); `CompletionState` (`AWAITING_CONFIRMATION/CONFIRMED/AUTO_RELEASED/DISPUTED`), `ReleaseReason` subset (`HOST_CONFIRMED/AUTO_RELEASE`), `IntentStatus` (`PENDING/DISPATCHED/ACCEPTED/FAILED_RETRYABLE`), `RatingRole`, and `ReleaseStatus` (`NOT_TRIGGERED/PENDING/ACCEPTED`) enums; `ChecklistCompletedPayload` (incl. `completedAt`); error strings (no payment secrets/PII embedded)
    - _Requirements: 1.1, 2.1, 5.1_

- [ ] 3. Repositories
  - [ ] 3.1 Implement ReleaseIntentRepository
    - Create `services/api/src/service-completion/repository/release-intent.repository.ts`: `drainClaimable(limit)` (selects `status IN ('PENDING','FAILED_RETRYABLE') OR (status='DISPATCHED' AND lease_until <= NOW())`, oldest first, bounded — the partial-index scan that makes an orphaned `DISPATCHED` reclaimable); `claimForDispatch(id, leaseMs, manager)` (the **single-winner lease claim**: `UPDATE ... SET status='DISPATCHED', dispatched_at=NOW(), lease_until=NOW()+:leaseMs WHERE id=:id AND (status IN ('PENDING','FAILED_RETRYABLE') OR (status='DISPATCHED' AND lease_until <= NOW()))`, returns rows affected — winner=1); `markAccepted(id, manager)`; `markFailedRetryable(id, error, manager)` (attempt++, clears `lease_until`, sanitized `last_error`); `findByCompletion(id)`; parameterized SQL only
    - _Requirements: 2.2, 8.1 · P2, P4_
  - [ ] 3.2 Implement ServiceRatingRepository
    - Create `services/api/src/service-completion/repository/service-rating.repository.ts`: `insertOnePerSide(params, manager)` (`ON CONFLICT (service_completion_id, role) DO NOTHING` — one per side, co-writes `service_rated` to `completion_outbox` in the same tx); `findByCompletion(completionId)`; parameterized SQL only
    - _Requirements: 5.1, 5.4, 8.1 · P5, P10_
  - [ ] 3.3 Implement CompletionRepository (completions + outbox + intent coordination)
    - Create `services/api/src/service-completion/repository/completion.repository.ts`: `createCompletion(params, manager)` idempotent `INSERT ... ON CONFLICT (service_session_id) DO NOTHING`; `transition(id, expected, next, derivedFields, intent?, outboxEvents, manager)` (the single-winner `UPDATE ... WHERE id=:id AND state=:expected` that sets derived fields AND — when release-bearing — inserts exactly one `release_intent` AND writes the `completion_outbox` row(s), all in ONE tx; returns rows affected, winner=1); `transitionPostReleaseDispute(id, disputeId, outboxEvents, manager)` (conditional `WHERE state IN ('CONFIRMED','AUTO_RELEASED') AND post_release_dispute_id IS NULL AND EXISTS (SELECT 1 FROM release_intents i WHERE i.service_completion_id=:id AND i.status='ACCEPTED')` — no state change, no intent; the `ACCEPTED` `EXISTS` clause makes it succeed only when the release actually executed; a matching decision state with a still-`PENDING`/`DISPATCHED` intent → rows=0 → mapped to `409`); `findById(id)`, `findBySessionId`, `findDueForAutoRelease(now, limit)` (partial-index scan `state='AWAITING_CONFIRMATION' AND auto_release_deadline <= now`); derive `release_status` from the completion's intent for the `GET` view; parameterized SQL only
    - _Requirements: 2.1, 3.1, 4.1, 4.3, 8.4, 8.5 · P4, P5, P9_
  - [ ]* 3.4 Unit tests for repositories
    - single-winner `transition` co-writes derived fields + exactly one intent + outbox in one tx (winner=1, loser=0); `uq_release_intents_completion` enforced (≤ one intent per completion); `transitionPostReleaseDispute` succeeds iff an `ACCEPTED` intent exists (rows=0 → `409` while `PENDING`/`DISPATCHED`); `claimForDispatch` is single-winner (a concurrent claim or an unexpired lease → rows=0); `drainClaimable` selects only eligible rows incl. expired-lease `DISPATCHED`; `markAccepted`/`markFailedRetryable` idempotent per final state; one-per-side rating `ON CONFLICT`; `findDueForAutoRelease` selects only due `AWAITING_CONFIRMATION`
    - _Requirements: 2.1, 2.2, 3.1, 4.3, 5.1, 8.4, 8.5 · P2, P4, P5, P9, P10_

- [ ] 4. Participation & creation services
  - [ ] 4.1 Implement CompletionParticipationService
    - Create `services/api/src/service-completion/service/completion-participation.service.ts`: `isHost(userId, completion)` / `isParticipant(userId, completion)` resolving `host_id`/`cleaner_id` (denormalized from the offer at creation); single source of the authorization rule for every endpoint; a nulled participant after user deletion resolves to non-participant for that id while the row is retained
    - _Requirements: 1.3, 2.4, 4.4, 5.5 · P3_
  - [ ] 4.2 Implement CompletionCreationService
    - Create `services/api/src/service-completion/service/completion-creation.service.ts`: `createFromChecklistCompleted(payload)` — reject if `payload.completedAt` is absent (deadline must anchor to the authoritative finish time, never consume time); resolve `host_id`/`cleaner_id`/`payment_id` server-side from the offer bound to `serviceSessionId`; set `checklist_completed_at = payload.completedAt`, snapshot `auto_release_deadline = checklist_completed_at + SERVICE_AUTO_RELEASE_WINDOW_MS`; `INSERT ... ON CONFLICT (service_session_id) DO NOTHING` (`state = AWAITING_CONFIRMATION`). Never throws into the consumer batch (per-row try/catch); a creation failure never touches the committed checklist finalize; never re-reads Spec 19's run. Functions ≤30 lines, SRP
    - _Requirements: 1.1, 1.2, 1.4, 1.5 · P1_
  - [ ]* 4.3 Unit tests for creation & participation
    - creates from the event; snapshots `auto_release_deadline` from `completedAt` (not consume time); rejects a missing `completedAt`; idempotent `ON CONFLICT`; resolves participants/`payment_id` from the offer; host/cleaner resolution + Host-only checks; nulled-participant → non-participant, row retained
    - _Requirements: 1.1, 1.2, 1.3, 1.5 · P1, P3_

- [ ] 5. Decision service (confirm / dispute / post-release-dispute, single-winner, Host-only)
  - [ ] 5.1 Implement CompletionDecisionService
    - Create `services/api/src/service-completion/service/completion-decision.service.ts`: `confirm(id, userId)` asserts the caller is the Host (else `403`), in ONE tx single-winner `AWAITING_CONFIRMATION → CONFIRMED` setting `confirmed_at` + `released_trigger='HOST_CONFIRMED'`, persists `release_intent { HOST_CONFIRMED, PENDING }`, writes `service_confirmed`; `rows=0` + already `CONFIRMED` → idempotent no-op returning current state; `rows=0` + `DISPUTED`/terminal-different → `409`; **never calls `EscrowReleaseService.release(...)` in the request path**. `openDispute(id, userId)` asserts Host; single-winner `AWAITING_CONFIRMATION → DISPUTED` setting `dispute_id`, writes `service_disputed`, **no intent** (auto-release suppressed); already `DISPUTED` → idempotent, else `409`. `openPostReleaseDispute(id, userId)` asserts Host; `transitionPostReleaseDispute` gated on `release_intent.status='ACCEPTED'` (state unchanged, no reversal, no intent cancellation); a decision state of `CONFIRMED`/`AUTO_RELEASED` with the release not yet `ACCEPTED` → `409` (release not yet executed — still a PRE-release concern); already post-disputed / not in a released decision state → `409`. Functions ≤30 lines, SRP
    - _Requirements: 2.1, 2.4, 2.5, 2.6, 4.1, 4.2, 4.3, 4.4 · P2, P3, P4, P5, P9_
  - [ ]* 5.2 Unit tests for CompletionDecisionService
    - Host-only gates (Cleaner/non-participant → `403`); single-winner confirm co-persists exactly one `PENDING` intent + `service_confirmed`; confirm on already-`CONFIRMED` → idempotent no-op, on `DISPUTED`/terminal → `409`, never a second intent; dispute persists no intent + suppresses auto-release; post-release-dispute succeeds only when the intent is `ACCEPTED` (state unchanged, no reversal), returns `409` when decision is `CONFIRMED`/`AUTO_RELEASED` but release not yet `ACCEPTED`
    - _Requirements: 2.1, 2.4, 2.5, 4.1, 4.3 · P3, P4, P9_

- [ ] 6. Auto-release service (server-authoritative, single-winner)
  - [ ] 6.1 Implement AutoReleaseService
    - Create `services/api/src/service-completion/service/auto-release.service.ts`: `autoReleaseDue(id)` — in ONE tx single-winner `UPDATE ... WHERE id=:id AND state='AWAITING_CONFIRMATION'` setting `released_trigger='AUTO_RELEASE'`, persists `release_intent { AUTO_RELEASE, PENDING }`, writes `service_confirmed { trigger: AUTO_RELEASE }`; `rows=0` (confirmed/disputed first) → no-op; idempotent; never calls Stripe directly (the deadline evaluated is the snapshotted `auto_release_deadline`, never a live config value or client timer)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5 · P4, P5, P6, P7, P8_
  - [ ]* 6.2 Unit tests for AutoReleaseService
    - single-winner `→ AUTO_RELEASED` + one `AUTO_RELEASE` intent + `service_confirmed`; no-op on non-`AWAITING_CONFIRMATION` (incl. `DISPUTED` → never auto-releases, never creates an intent); never calls Stripe; evaluates the snapshotted deadline
    - _Requirements: 3.1, 3.3, 3.4 · P6, P7_

- [ ] 7. Rating service (captured, never gating)
  - [ ] 7.1 Implement RatingService
    - Create `services/api/src/service-completion/service/rating.service.ts`: `submitRating(id, userId, dto)` asserts participant AND completion state ∈ {`CONFIRMED`,`AUTO_RELEASED`} (else `403`/`409`); resolves `role` (`HOST_RATES_CLEANER`/`CLEANER_RATES_HOST`) from participants; validates `stars ∈ [SERVICE_RATING_MIN_STARS, SERVICE_RATING_MAX_STARS]` (else `400`); `insertOnePerSide` (`ON CONFLICT (service_completion_id, role) DO NOTHING`) + co-writes `service_rated` in the same tx; never touches `state` or intents (a duplicate side → `409`, non-participant → `403`). `getRatings(id, userId)` participant-gated read consistent with the participants
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5 · P5, P10_
  - [ ]* 7.2 Unit tests for RatingService
    - eligibility (state ∈ {CONFIRMED, AUTO_RELEASED}, participant); stars bounds from config (out of range → `400`); one-per-side `ON CONFLICT` (duplicate → `409`); `service_rated` co-write; never touches `state`/intents; a missing rating never blocks confirm/auto-release
    - _Requirements: 5.1, 5.2, 5.3, 5.4 · P10_

- [ ] 8. Completion-created consumer (`consumer_name='completion'` over Spec 19's outbox)
  - [ ] 8.1 Implement CompletionCreatedConsumer
    - Create `services/api/src/service-completion/consumers/completion-created.consumer.ts`: drain `checklist_completed` rows unacked for `consumer_name = 'completion'` (reuse Spec 19's `ChecklistOutboxConsumerCheckpoint.drainUnacked('completion', batch)` over `checklist_outbox`, ordered by `created_at`, bounded batch), call `createFromChecklistCompleted(payload)`, then `ack(eventId, 'completion')` (`ON CONFLICT DO NOTHING`). At-least-once + idempotent (dedup by `UNIQUE service_session_id`); row-scoped try/catch so one bad row never stalls the batch and never touches the already-committed checklist finalize; coexists with the Spec 21 dispute-evidence consumer on the same fan-out (its own `(event_id, 'completion')` ack row)
    - _Requirements: 1.1, 1.2, 1.5 · P1_
  - [ ]* 8.2 Unit tests for the consumer
    - idempotent creation via its own `'completion'` checkpoint (no shared marker on the upstream table), copying `completedAt` from the event; redelivery → still one completion; a bad row isolated from the batch and from the upstream flow; fan-out coexistence with the Spec 21 consumer
    - _Requirements: 1.1, 1.2, 1.5 · P1_

- [ ] 9. Jobs (auto-release sweep + release-intent worker with lease claim)
  - [ ] 9.1 Implement AutoReleaseSweepProcessor
    - Create `services/api/src/service-completion/jobs/auto-release-sweep.processor.ts` (BullMQ repeatable; interval/batch from config): select `service_completions` where `state='AWAITING_CONFIRMATION' AND auto_release_deadline <= NOW()` (bounded batch, partial index), call `AutoReleaseService.autoReleaseDue(id)` per row (single-winner, idempotent); a disputed/confirmed completion is not selected (state changed); bounded and re-runnable
    - _Requirements: 3.1, 3.2, 3.4 · P6, P7_
  - [ ] 9.2 Implement ReleaseIntentWorker
    - Create `services/api/src/service-completion/jobs/release-intent.worker.ts` (BullMQ repeatable; interval/batch from config): drain claimable `release_intents` (`drainClaimable`, oldest first, batched), **claim** each via the single-winner lease `claimForDispatch(id, SERVICE_COMPLETION_RELEASE_INTENT_LEASE_MS)`, call `EscrowReleaseService.release(payment_id, reason)` (idempotent; Spec 9 single-winner), then `markAccepted` on success or `markFailedRetryable` (attempt++) on transient failure → retried next drain. `ACCEPTED` records that **Spec 9 durably accepted the release COMMAND** — not that funds have settled (a deferred `payout_status = PENDING` when `payouts_enabled = false` is still `ACCEPTED`). This is the ONLY path that calls Spec 9; it holds no Stripe keys. Recovery-safe by lease: an intent left `DISPATCHED` by a crash is re-claimable once its `lease_until` passes, re-driving `release(...)` (a Spec-9 no-op) — an orphaned `DISPATCHED` is never permanently lost
    - _Requirements: 2.2, 2.3, 7.2 · P2, P4_
  - [ ]* 9.3 Unit tests for jobs
    - sweep selects only due `AWAITING_CONFIRMATION` rows (partial index), bounded, idempotent, excludes `DISPUTED`; worker drains claimable intents (`PENDING`/`FAILED_RETRYABLE`/expired-lease `DISPATCHED`), claims via single-winner `claimForDispatch` → `ACCEPTED` (mocked `EscrowReleaseService`); `FAILED_RETRYABLE` on transient error (attempt++); re-claims and re-drives a `DISPATCHED` intent only after its lease expires (a live, unexpired dispatch is not stolen); a re-call is a Spec-9 no-op; `ACCEPTED` recorded even when payout deferred; the only path calling Spec 9; holds no Stripe keys
    - _Requirements: 2.2, 2.3, 3.1, 7.2 · P2, P4, P6_

- [ ] 10. Controller, DTOs & module wiring
  - [ ] 10.1 Add completion endpoints + DTOs
    - Create `services/api/src/service-completion/completion.controller.ts` (`@Controller('service-completions') @UseGuards(JwtAuthGuard)`, whitelisting `ValidationPipe`) + DTOs (`open-dispute.dto.ts`, `submit-rating.dto.ts`): `GET /service-completions/:id` (participant-gated → authoritative state + snapshotted `auto_release_deadline` + rating status + **derived `release_status`** `NOT_TRIGGERED`/`PENDING`/`ACCEPTED`; internal intent fields `attempt`/`dispatched_at`/`lease_until`/`last_error` NOT exposed); `POST /:id/confirm` (Host only → `CONFIRMED` + `release_intent(HOST_CONFIRMED)` + `service_confirmed`); `POST /:id/dispute` (Host only → `DISPUTED` + `service_disputed`, suppresses auto-release); `POST /:id/post-release-dispute` (Host only → sets `post_release_dispute_id` + `service_disputed`, state preserved; allowed ONLY when `release_status = ACCEPTED`, else `409` release not yet executed); `POST /:id/ratings` (Host or Cleaner → one per side, 1..5 + optional comment + `service_rated`); `GET /:id/ratings` (participant-gated read). Identity from `req.user.keycloakId → userId`; non-participant → `403`, no existence disclosure; `release` is NOT a REST action (driven only by the worker). Status codes `200/400/401/403/404/409`
    - _Requirements: 1.3, 2.1, 2.4, 2.5, 3.x (GET reconcile), 4.1, 4.3, 5.1, 5.5, 6.3 · P3, P9, P11_
  - [ ] 10.2 Wire the service-completion module
    - Create `services/api/src/service-completion/service-completion.module.ts`: register the controller, all services (creation/decision/auto-release/rating/participation), the three repositories, the `CompletionCreatedConsumer`, the two processors (auto-release sweep + release-intent worker) + their BullMQ queues (reuse the existing Redis/BullMQ setup), and the new entities; import Spec 9's `EscrowReleaseService` seam and Spec 19's `ChecklistOutboxConsumerCheckpoint`; call `validateServiceCompletionConfig()` on boot; register the module in the app module
    - _Requirements: 7.1, 7.2_
  - [ ]* 10.3 Endpoint integration tests
    - `GET` exposes state/deadline/rating status + derived `release_status` only (never internal intent fields); confirm/dispute Host-only (Cleaner/non-participant → `403`); post-release-dispute → `409` until `release_status = ACCEPTED`; ratings one-per-side (duplicate → `409`, out-of-range → `400`); non-participant → `403` on all endpoints, no disclosure; no Stripe SDK imported anywhere in the module
    - _Requirements: 1.3, 2.4, 4.3, 5.3, 5.5 · P3, P9, P11_

- [ ] 11. Checkpoint — backend compiles, tests green, CI-equivalent
  - Ensure `services/api` typechecks, ESLint (`--max-warnings 0`) clean on touched files, and the full API suite passes; ask the user if questions arise.

- [ ] 12. Mobile core (types, api, store, countdown)
  - [ ] 12.1 Create mobile completion types & constants
    - Create `apps/mobile/src/screens/completion/completion.types.ts` (`ServiceCompletion` incl. `state`, `autoReleaseDeadline`, `releasedTrigger`, `confirmedAt`, `disputeId`, `postReleaseDisputeId`, and `releaseStatus: 'NOT_TRIGGERED' | 'PENDING' | 'ACCEPTED'` — the server-derived status, no internal intent fields; `ServiceRating` (`role`, `stars`, `comment`), enums, `ConnectionStatus`) and `completion.constants.ts` (routes/endpoints, i18n keys, dark design tokens `#00F5D4` accent for confirm/rating CTAs, `#0B0C10` background, `#1F2833` cards; no security-sensitive values embedded)
    - _Requirements: 6.5, 7.4_
  - [ ] 12.2 Implement useAutoReleaseCountdown
    - Create `apps/mobile/src/screens/completion/useAutoReleaseCountdown.ts`: derive a display-only countdown from the durable `auto_release_deadline` returned by `GET` — a display of the server deadline, NOT an authoritative client timer; on expiry re-fetch via `GET` rather than mutating state locally
    - _Requirements: 6.1, 6.2 · P11_
  - [ ] 12.3 Implement completion.api.ts + store
    - Create `apps/mobile/src/screens/completion/completion.api.ts` (confirm / dispute / post-release-dispute / submit-rating / GET completion / GET ratings) and `completion.store.ts` (Zustand): completion + rating status; optimistic confirm/dispute reconciled via `GET`; idempotent state application (ignore regressions/older/illegal transitions); the Cleaner's released / pending-payout / disputed view sourced from the server-derived `releaseStatus`
    - _Requirements: 6.2, 6.3, 6.4 · P11_
  - [ ]* 12.4 Unit tests for countdown, api & store
    - `useAutoReleaseCountdown` derives from the durable deadline, on expiry re-fetches via `GET`, never an authoritative client timer; api composes confirm/dispute/post-release-dispute/rate/GET; store optimistic confirm/dispute reconciled via `GET`, ignores older/illegal transitions; `releaseStatus` drives the Cleaner release/pending-payout/disputed display
    - _Requirements: 6.1, 6.2, 6.3 · P11_

- [ ] 13. Mobile screens & i18n
  - [ ] 13.1 Implement CompletionHostScreen + CompletionCleanerScreen + components
    - Create `apps/mobile/src/screens/completion/CompletionHostScreen.tsx` (Host: confirm-satisfaction action, dispute action, visible auto-release countdown from the durable deadline; on confirm reflects `CONFIRMED` + prompts for a rating; if the Host does nothing reflects `AUTO_RELEASED` after the deadline (reconciled via `GET`); on dispute reflects `DISPUTED` + hands off to Spec 21 clearly indicating auto-release is paused), `CompletionCleanerScreen.tsx` (Cleaner: release status released / pending payout / disputed sourced from the server-derived `releaseStatus`; prompts for a rating), and `components/ConfirmDisputeActions.tsx`, `AutoReleaseCountdown.tsx`, `ReleaseStatusBadge.tsx`, `RatingSheet.tsx` (stars 1..5 + optional comment); wire navigation from the finished-job entry point in both role navigators; dark BidClean tokens (`#00F5D4` accent for confirm/rating CTAs, `#0B0C10` bg, `#1F2833` cards)
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [ ] 13.2 Add completion i18n (en + es)
    - Create `apps/mobile/src/i18n/locales/en/completion.json` and `es/completion.json` (parity): confirm/dispute actions, auto-release countdown, paused-while-disputed indicator, release status (released / pending payout / disputed), rating stars + comment, error states
    - _Requirements: 6.5_
  - [ ]* 13.3 Unit/render tests for screens & components
    - Host confirm/dispute actions + countdown; Host reflects `CONFIRMED`/`AUTO_RELEASED`/`DISPUTED` (paused indicator on dispute); Cleaner shows release status from `releaseStatus`; rating stars 1..5 + optional comment; dark tokens; `en`/`es` i18n parity; apiClient mocked (zero real external calls)
    - _Requirements: 6.3, 6.4, 6.5_

- [ ] 14. Checkpoint — full completion UX integrated on mobile
  - Ensure countdown + store + screens + navigation + i18n work together against mocks; mobile `tsc --noEmit` + ESLint + Jest clean; ask the user if questions arise.

- [ ] 15. Property-Based Tests (fast-check, min 100 iterations, tagged `// Feature: service-completion, Property N`)
  - [ ]* 15.1 Property 1 — One completion per session, idempotent, deadline snapshotted from the finish time
    - **Property 1: One completion per session, created idempotently, deadline snapshotted from the authoritative finish time**
    - **Validates: Requirements 1.1, 1.5 · REQ-SC1, REQ-SC4**
    - Random `checklist_completed` payloads (varying `completedAt`) × N redeliveries × concurrent creation interleavings: exactly one completion per session, `AWAITING_CONFIRMATION`; `deadline == completedAt + window`; redelivery/concurrent attempt is a no-op; anchored to `completedAt`, never consume time
  - [ ]* 15.2 Property 2 — Durable intent, crash-safe (lease-reclaim), only release path
    - **Property 2: Completion durably enqueues release, never performs it (crash-safe, only release path)**
    - **Validates: Requirements 2.1, 2.2, 7.2 · REQ-SC2**
    - Random release-bearing decisions × crash points between commit and Stripe (incl. a crash leaving the intent `DISPATCHED` with an expired lease) × transient failures × deferred payout (`payouts_enabled=false`, mocked `release`): exactly one `PENDING` intent committed with the decision; no synchronous release; worker claims via single-winner lease; a `DISPATCHED`-with-expired-lease intent is re-claimed and re-driven (Spec-9 no-op → at most one Transfer); eventual `ACCEPTED` = release COMMAND accepted (still `ACCEPTED` when payout deferred); `FAILED_RETRYABLE` retried; never lost; only the worker calls Spec 9; no Stripe keys
  - [ ]* 15.3 Property 3 — Host-only decisions, participant isolation
    - **Property 3: Host-only decisions, participant isolation**
    - **Validates: Requirements 1.3, 2.4, 4.4, 5.5 · REQ-SC6, REQ-SC1**
    - Random (user, endpoint, role) tuples: access iff participant; confirm/dispute (pre/post) iff Host; Cleaner/non-participant → `403`, no disclosure; ratings participant-consistent
  - [ ]* 15.4 Property 4 — Single-winner decision + single-winner release ⇒ no double pay & no lost release
    - **Property 4: Single-winner decision + single-winner release ⇒ no double pay & no lost release**
    - **Validates: Requirements 2.1, 2.5, 3.1, 3.3, 8.5 · REQ-SC3**
    - Random N concurrent confirm/auto-release/dispute-open × mocked single-winner `release`: exactly one of `CONFIRMED`/`AUTO_RELEASED`/`DISPUTED`; ≤ one `release_intent` (`uq_release_intents_completion`); at most one Transfer per payment; no lost release; confirm on non-`AWAITING_CONFIRMATION` → idempotent/`409`, never a second intent
  - [ ]* 15.5 Property 5 — Transition + outbox atomicity
    - **Property 5: Transition + outbox atomicity**
    - **Validates: Requirements 2.6, 3.5, 4.1, 5.4, 8.4 · REQ-SC3**
    - Random transitions + random rating inserts: every transition co-writes derived fields + exactly one `service_confirmed`/`service_disputed` in the same tx; every rating co-writes one `service_rated`; no `CONFIRMED`/`AUTO_RELEASED` without a `released_trigger` (DDL `CHECK`); no two triggers
  - [ ]* 15.6 Property 6 — Server-authoritative, durable auto-release from the finish time
    - **Property 6: Server-authoritative, durable auto-release from the authoritative finish time**
    - **Validates: Requirements 3.1, 3.2, 7.3 · REQ-SC4**
    - Random completions × deadlines × `now`: due, non-disputed completions converge to `AUTO_RELEASED` (single-winner, one intent) using the snapshotted deadline; sweep bounded/idempotent; no Stripe call; a delayed queue grants no extra time
  - [ ]* 15.7 Property 7 — Dispute suppresses auto-release
    - **Property 7: Dispute suppresses auto-release**
    - **Validates: Requirements 3.4, 4.2 · REQ-SC5**
    - Random `DISPUTED` completions past the deadline: sweep never transitions, never creates an intent; no completion-side `HOST_CONFIRMED`/`AUTO_RELEASE` trigger fires
  - [ ]* 15.8 Property 8 — Deadline invariance to later config change
    - **Property 8: Deadline invariance to later config change**
    - **Validates: Requirements 3.2, 7.3 · REQ-SC4, REQ-SC11**
    - Random creation + later `SERVICE_AUTO_RELEASE_WINDOW_MS` mutations: `auto_release_deadline` == the value snapshotted at creation, invariant to later config
  - [ ]* 15.9 Property 9 — Pre-release vs post-release disputes are distinct (ACCEPTED gate)
    - **Property 9: Pre-release vs post-release disputes are distinct**
    - **Validates: Requirements 4.2, 4.3 · REQ-SC12**
    - Random `CONFIRMED`/`AUTO_RELEASED` completions × intent status ∈ {PENDING, DISPATCHED, FAILED_RETRYABLE, ACCEPTED}: post-release dispute accepted iff `release_intent.status = ACCEPTED` (sets `post_release_dispute_id`, emits `service_disputed`, leaves state unchanged, no `DISPUTED` transition, no intent, no reversal, no cancellation); while intent still PENDING/DISPATCHED/FAILED_RETRYABLE → `409` (release not yet executed); `DISPUTED` only reachable from `AWAITING_CONFIRMATION`
  - [ ]* 15.10 Property 10 — Ratings captured, never gating
    - **Property 10: Ratings captured, never gating**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4 · REQ-SC8**
    - Random states × stars (in/out of range) × sides × duplicates × with/without rating: accept iff state ∈ {CONFIRMED, AUTO_RELEASED} + participant + in-range + free side; else `403`/`409`/`400`; `UNIQUE` per side; release decision/intent/timing identical regardless of rating
  - [ ]* 15.11 Property 11 — Realtime advisory; GET reconciliation authoritative (derived `release_status`)
    - **Property 11: Realtime is advisory; `GET` reconciliation is authoritative**
    - **Validates: Requirements 6.1, 6.2 · REQ-SC10**
    - Random publish outcomes / dropped frames × intent statuses: durable state + deadline + rating status identical; `GET` returns authoritative state + derived `release_status` (`NOT_TRIGGERED`/`PENDING`/`ACCEPTED`, no internal intent fields) independent of realtime; the countdown is a display of the durable deadline
  - [ ]* 15.12 Property 12 — Deletion coherence (release path never lost)
    - **Property 12: Deletion coherence (no cascade-from-users; session/offer cascades the completion)**
    - **Validates: Requirements 8.2, 8.3 · REQ-SC9**
    - Random completion/intent/rating graphs (intents in varied statuses) + participant deletion + parent session/offer cascade: user FKs (`host_id`/`cleaner_id`/`rater_id`/`ratee_id`) nulled + rows retained; session/offer delete cascades completion + ratings but **`release_intents` survive** (`service_completion_id` → NULL) so the worker still drives the retained intent to `ACCEPTED`; `payment_id` row untouched (payments its own bounded context)
  - [ ]* 15.13 Property 13 — No hardcoded config/secrets; no PII/secrets leaked
    - **Property 13: No hardcoded config/secrets; no PII/secrets leaked**
    - **Validates: Requirements 7.1, 7.2, 7.4 · REQ-SC11**
    - Random config maps (missing/invalid/valid, incl. lease ≤ drain interval): validator throws iff required missing/invalid (incl. `SERVICE_COMPLETION_RELEASE_INTENT_LEASE_MS ≤ 0` or `≤ interval`); no Stripe keys; logs/outbox carry no secrets/PII (ids/enums/routing fields only); rating comments escaped, never executed

- [ ] 16. DDL / Migration Tests
  - [ ]* 16.1 Schema, constraints & index tests
    - Constraints/indexes present: `UNIQUE service_session_id`; `uq_release_intents_completion`; `uq_service_ratings_completion_role`; FK indexes on every FK; the sweep partial index (`WHERE state='AWAITING_CONFIRMATION'`); the intent drain/claim partial index (`WHERE status IN ('PENDING','FAILED_RETRYABLE','DISPATCHED')`, supporting the expired-lease reclaim scan); `dispatched_at`/`lease_until` columns present and nullable; `CHECK` on `state`/`released_trigger`/`reason`/`status`/`role`/`stars (1..5)`; the `released_trigger` coherence `CHECK`; `event_id UNIQUE` on `completion_outbox`; no `deleted_at` on any table. Deletion coherence: user FKs `ON DELETE SET NULL`; `service_session_id`/`offer_id` (→ `service_completions`) and `service_ratings.service_completion_id` `ON DELETE CASCADE`; **`release_intents.service_completion_id` `ON DELETE SET NULL`** (durable financial command, retained on completion deletion); `payment_id` has no FK cascade from payments. Migration reversible: `up()` + `down()` both run; `IF NOT EXISTS`; table/column comments present
    - _Requirements: 8.1, 8.2, 8.3 · P4, P8, P12_

- [ ] 17. Integration & Scenario Tests
  - [ ]* 17.1 Integration: creation, fan-out coexistence & idempotency (backend)
    - `checklist_completed` (with `completedAt`) → completion created (`AWAITING_CONFIRMATION`) via the `'completion'` checkpoint; `deadline == completedAt + window`; redelivery → still one completion; fan-out coexistence with the Spec 21 dispute-evidence consumer on the same `checklist_outbox`; a missing `completedAt` event → creation rejected/deferred (never anchored to consume time)
    - _Requirements: 1.1, 1.2, 1.5 · P1_
  - [ ]* 17.2 Integration: confirm → intent → worker → release incl. crash-reclaim & deferred payout (backend)
    - Confirm → `CONFIRMED` + `PENDING` intent + `service_confirmed`; worker claims (lease) + drains → `EscrowReleaseService.release(HOST_CONFIRMED)` (mocked) → intent `ACCEPTED`; crash between commit and drain → intent still drained on recovery; crash leaving the intent `DISPATCHED` → after `lease_until` passes it is re-claimed and re-driven (no double, no lost, Spec-9 no-op); deferred payout (`release` reports not-eligible) → confirm stays `CONFIRMED`, intent `ACCEPTED`, no failure
    - _Requirements: 2.1, 2.2, 2.3 · P2, P4_
  - [ ]* 17.3 Integration: auto-release & three-way race (backend)
    - Unconfirmed past the snapshotted deadline → sweep `AUTO_RELEASED` + `AUTO_RELEASE` intent + `service_confirmed { AUTO_RELEASE }`; disputed-before-deadline → never auto-released; concurrent confirm/auto-release/dispute → exactly one terminal, ≤ one intent, at most one Transfer
    - _Requirements: 3.1, 3.3, 3.4, 8.5 · P4, P6, P7_
  - [ ]* 17.4 Integration: pre-release & post-release disputes (ACCEPTED gate) (backend)
    - Pre-release dispute → `DISPUTED` + `service_disputed`, auto-release suppressed; post-release dispute on a completion whose intent is `ACCEPTED` → `post_release_dispute_id` set, state preserved, `service_disputed` emitted, no reversal; post-release dispute while the intent is still `PENDING`/`DISPATCHED` → `409` (release not yet executed), then succeeds after the worker drives the intent to `ACCEPTED`
    - _Requirements: 4.1, 4.2, 4.3 · P7, P9_
  - [ ]* 17.5 Integration: ratings, authorization & deletion coherence (backend)
    - Ratings: one per side on a released completion; duplicate side → `409`; rating on non-released → `409`; out-of-range stars → `400`; a release never waits on a rating. Non-participant denied on every endpoint; Cleaner denied on confirm/dispute; user deletion → user FKs SET NULL, rows retained; session/offer cascade removes completion + ratings but **retains `release_intents`** (`service_completion_id` nulled) and the worker still drives the retained intent to `ACCEPTED`; payment (`payment_id`) untouched
    - _Requirements: 5.1, 5.2, 5.3, 8.2, 8.3 · P3, P10, P12_

- [ ] 18. Final Checkpoint — all tests pass, CI green, docs updated
  - Ensure the full API suite + mobile suite pass and CI-equivalent commands are green; update module READMEs (`services/api/src/service-completion/README.md`, `apps/mobile/src/screens/completion/README.md`, note the new `checklist_outbox` `consumer_name='completion'` checkpoint + the additive `completedAt` field on `checklist_completed` in the checklist-photos README), `docs/ARCHITECTURE.md` (add the service-completion module + a completion/release flow diagram — `checklist_completed` (carrying `completedAt`) → create + snapshot deadline → Host confirm / deadline sweep / dispute-open → single-winner transition + `release_intent` → release-intent worker → `EscrowReleaseService.release` → Spec 9 Transfer; the dispute + post-release-dispute routing edges; the `service_confirmed`/`service_disputed`/`service_rated` fan-out to Push/reputation; the edges to Spec 19 `checklist_outbox` and Spec 9 `EscrowReleaseService`), `docs/CHANGELOG.md` (`[Unreleased]` entries per task group), a new **ADR-010** (completion-decision-vs-escrow-authority split; the durable-release-intent pattern with lease-based `DISPATCHED` reclaim; `ACCEPTED` = release-COMMAND-accepted semantics; the server-authoritative snapshotted deadline from `completedAt`; single-winner + Spec 9 single-winner ⇒ at-most-one-Transfer; the pre-release `DISPUTED` vs post-release `post_release_dispute_id` distinction gated on `release_status = ACCEPTED`; the `release_intent` as a durable financial command surviving completion deletion via `ON DELETE SET NULL`), `.env.example` (all `SERVICE_*` keys incl. `SERVICE_COMPLETION_RELEASE_INTENT_LEASE_MS`, no Stripe keys), and mark Spec 20 complete in `.kiro/specs/ROADMAP.md`; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests) and can be skipped for a faster MVP — but per this project's execution rules they are executed (unit, property-based, DDL, integration, mobile).
- Each task references specific requirements; property/integration tests cite the design's P1–P13 and the requirements' REQ-SC1…REQ-SC12.
- **Authority split (strict).** PostgreSQL is the source of truth for the completion DECISION + ratings; the escrow module (Spec 9) is the source of truth for money; checklist-photos (Spec 19) is the source of truth for what was done + the finish clock (`completedAt`); the auto-release deadline is server-authoritative and durable. `service-completion` owns the WHEN/decision, never the HOW of money.
- **Durable-event init:** the completion is created by consuming the `checklist_completed` outbox fact via a `consumer_name='completion'` checkpoint over Spec 19's `checklist_outbox` fan-out — never a synchronous call from checklist-photos; a creation failure never rolls back the checklist finalize. The deadline is snapshotted from the event-carried `completedAt`, never consume time.
- **Durable release intent + lease reclaim:** every release-bearing decision (`CONFIRMED`/`AUTO_RELEASED`) commits exactly one `release_intent { payment_id, reason, PENDING }` in the SAME transaction; a worker drains it into Spec 9's single-winner `release` with idempotent retries. The worker claims each intent via a single-winner lease (`status='DISPATCHED', dispatched_at, lease_until`); an intent orphaned `DISPATCHED` by a crash is durably re-claimable once its `lease_until` passes — a terminal completion is never left with no release path.
- **`ACCEPTED` = release COMMAND accepted, not funds settled.** A deferred payout (`payouts_enabled=false` → Spec 9 leaves `payout_status = PENDING`) is still `ACCEPTED`. The Cleaner UI's released / pending-payout / disputed distinction reflects the server-derived `release_status` (`NOT_TRIGGERED`/`PENDING`/`ACCEPTED`).
- **Single-winner everywhere money is involved:** confirm / auto-release / dispute-open are conditional writes (`WHERE state='AWAITING_CONFIRMATION'`); each release-bearing winner persists exactly one intent; the escrow release is itself single-winner — together at most one Transfer per payment (even under confirm-racing-auto-release) and never a lost release.
- **Pre-release vs post-release disputes are distinct.** `DISPUTED` is pre-release only (suppresses auto-release, reachable solely from `AWAITING_CONFIRMATION`). A post-release dispute sets `post_release_dispute_id` and routes to Spec 21 **only when `release_status = ACCEPTED`** (money actually moved); a dispute while the release is still `PENDING`/`DISPATCHED` is a PRE-release concern → `409` until `ACCEPTED`. Never overloads `DISPUTED`, never reverses the Transfer here.
- **`release_intent` survives completion deletion.** `release_intents.service_completion_id` is `ON DELETE SET NULL` (not `CASCADE`): a durable financial command carrying its own `payment_id`/`reason` that completes independently even when the originating completion cascades away — the release path is never lost. Ratings, being audit data, still cascade.
- **Ratings captured, never gating:** one per side (`UNIQUE (service_completion_id, role)`); a release never waits on a rating; a missing rating never blocks confirm/auto-release.
- **`GET` reconciliation is authority; realtime is advisory:** completion state + the durable deadline + `GET /service-completions/:id` (incl. derived `release_status`, no internal intent fields exposed) are authoritative; a missed push/realtime frame never changes whether/when release fires. The mobile countdown is a display of the durable server deadline.
- **No Stripe here:** `service-completion` holds no Stripe keys, makes no Stripe calls, and recomputes no commission (the release-intent worker calls only Spec 9's internal `release`). No payment secrets or PII in logs/outbox payloads (ids/enums/routing fields only); rating comments are user content — validated/escaped, never executed.
- **Out of scope:** moving money / calling Stripe / recomputing commission / reimplementing escrow release (Spec 9); dispute resolution — evidence weighing, partial refunds, reversals (Spec 21, this module only routes into it + guarantees auto-release suppression); the cancellation-penalty ladder; gating release on ratings or building reputation/favorites (Spec 22); a client-side authoritative countdown; push delivery (Spec 16); any change to the escrow/checklist/service-tracking/offer contracts beyond creating the completion from `checklist_completed`, driving the existing release, and routing to disputes.
- CI: backend jobs (API lint/typecheck, API tests) must stay green; mobile is verified locally (`tsc --noEmit` + ESLint + Jest).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["3.1", "3.2", "3.3"] },
    { "id": 3, "tasks": ["3.4", "4.1", "4.2"] },
    { "id": 4, "tasks": ["4.3", "5.1", "6.1", "7.1"] },
    { "id": 5, "tasks": ["5.2", "6.2", "7.2", "8.1"] },
    { "id": 6, "tasks": ["8.2", "9.1", "9.2"] },
    { "id": 7, "tasks": ["9.3", "10.1"] },
    { "id": 8, "tasks": ["10.2", "10.3"] },
    { "id": 9, "tasks": ["12.1", "12.2", "12.3"] },
    { "id": 10, "tasks": ["12.4", "13.1", "13.2"] },
    { "id": 11, "tasks": ["13.3", "15.1", "15.2", "15.3", "15.4", "15.5", "15.6", "15.7"] },
    { "id": 12, "tasks": ["15.8", "15.9", "15.10", "15.11", "15.12", "15.13", "16.1"] },
    { "id": 13, "tasks": ["17.1", "17.2", "17.3", "17.4", "17.5"] }
  ]
}
```
