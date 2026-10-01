# Requirements Document

## Introduction

The `service-completion` module closes the service loop: after the Cleaner finalizes the checklist (Spec 19's `checklist_completed`), the Host either **confirms satisfaction** — which releases the escrowed payment to the Cleaner — or does nothing, in which case an **auto-release** fires after a configured window (the plan's 24h), or the Host **opens a dispute** (Spec 21), which pauses auto-release. It also captures the mutual **rating** at the end. It is Spec 20, the last of Sprint 5 (Service Execution), depending on stripe-escrow (Spec 9, ✅) for the money movement and checklist-photos (Spec 19) for the completion record.

**It decides WHEN money moves and DURABLY enqueues that intent; it does not reimplement HOW.** The escrow is already built (Spec 9): `EscrowReleaseService.release(paymentId, ReleaseReason)` performs the Stripe Transfer, is single-winner (concurrent triggers yield exactly one Transfer), defers the payout if the Cleaner's account is not yet eligible, and is paused by an active dispute. `service-completion` **owns the completion decision** — host-confirmed vs auto-release vs disputed — and, **crucially, does NOT call `release()` synchronously "after" the transition**. Instead, in the **same transaction** that commits the decision (`CONFIRMED`/`AUTO_RELEASED`), it persists a durable **release intent** (`{ paymentId, reason, status: PENDING }`); a separate worker/outbox processor then executes `EscrowReleaseService.release(...)` with idempotent retries. This closes the crash gap: if the process dies after committing `CONFIRMED` but before the Stripe call, the durable intent is retried on recovery, so a terminal completion can never leave the escrow un-triggered. `service-completion` never issues Stripe calls itself, never recomputes commission, and never bypasses the escrow's own guarantees. The escrow (Spec 9) remains the source of truth for money; `service-completion` is the source of truth for *the decision + the durable intent to release*.

**Pre-release vs post-release are distinct.** The completion state machine governs only the **pre-release** decision (`AWAITING_CONFIRMATION → CONFIRMED | AUTO_RELEASED | DISPUTED`, where `DISPUTED` means "disputed before release, suppressing auto-release"). A dispute raised **after** release already fired is a **different concept** — a post-release dispute routed to Spec 21 — and is NOT modeled as a `CONFIRMED → DISPUTED` transition (that would overload `DISPUTED`'s pre-release meaning). See Req 4.

**A completion is bound to the service session, not a new payment domain.** When `checklist_completed` fires for a session, a `service_completions` row is created for it, with participants exactly the session's `hostId`/`cleanerId` and a reference to the escrow payment (via the offer). Authorization derives from the matched offer's two parties, resolved server-side. The completion has its own lifecycle — `AWAITING_CONFIRMATION → CONFIRMED | AUTO_RELEASED | DISPUTED` — that governs which release trigger fires (or is suppressed).

**Authority split (kept strict):**
- **PostgreSQL is the source of truth for the completion decision + ratings.** The `service_completions` row (state, who confirmed, when, the auto-release deadline, the dispute link, the rating rows) is durable. It records the *decision*; it is not the money ledger.
- **The escrow module (Spec 9) is the source of truth for money.** Whether funds are HELD/RELEASED/REFUNDED, the Transfer, the payout status — all live in payments and are authoritative there. `service-completion` never calls `release(...)` synchronously: it persists a **durable release intent** in the decision transaction, and a worker drives that intent into Spec 9's single-winner release with idempotent retries (or the dispute path suppresses it). The intent stays `PENDING` until Spec 9 confirms the release was accepted/processed.
- **checklist-photos (Spec 19) is the source of truth for what was done.** `service-completion` reacts to `checklist_completed`; it does not re-derive checklist state.
- **The auto-release deadline is server-authoritative and durable.** The 24h (configurable) countdown is a persisted deadline swept by the server, not a client timer; a client "confirm" is the fast path, the sweep is the guarantee.

**Deliberate scope boundaries (to keep the MVP correct and safe with money):**
- **Completion triggers release; it never moves money directly.** All Stripe interaction stays in Spec 9. `service-completion` maps a decision to a `ReleaseReason` and calls the existing single-winner release.
- **Disputes are Spec 21; completion only routes into them.** Opening a dispute transitions the completion to `DISPUTED` and **suppresses auto-release**; the dispute's resolution (release / refund / partial) is Spec 21's job. `service-completion` provides the entry point and the "auto-release is paused while disputed" guarantee, not the resolution logic.
- **Cancellation penalties are referenced, not owned here.** The plan's cancellation-count penalties are their own concern; `service-completion` covers the *satisfactory-finish* path (confirm / auto-release / dispute), not the cancellation ladder.
- **Ratings are captured, not gated on.** A mutual rating (Host↔Cleaner) is collected at completion but SHALL NOT block release (a Host who never rates still triggers auto-release; a release never waits on a rating). Ratings feed reputation/favorites (Spec 22) later.
- **Idempotent, single-winner everywhere money is involved.** Confirm, auto-release, and dispute-open are conditional single-winner transitions; the underlying release is itself single-winner (Spec 9), so double-confirm or confirm-racing-auto-release never double-pays.
- **Correctness does not depend on realtime.** Completion state + the durable deadline + `GET` reconciliation are authoritative; a missed push/realtime frame never changes whether/when release fires.

## Domain Model Overview

```
checklist run (Spec 19) ── durable event checklist_completed ──► a completion is initialized for the session
        │ 1:1 (one completion per service session)
        ▼
service_completions (new — the durable completion DECISION; never the money ledger)
        id, service_session_id (FK → service_sessions ON DELETE CASCADE, UNIQUE),
        offer_id (FK → offers ON DELETE CASCADE), payment_id (ref to the escrow payment, Spec 9),
        host_id (FK → users ON DELETE SET NULL), cleaner_id (FK → users ON DELETE SET NULL),
        state (AWAITING_CONFIRMATION | CONFIRMED | AUTO_RELEASED | DISPUTED),
          -- PRE-RELEASE only. DISPUTED = disputed before release (suppresses auto-release).
          -- A dispute AFTER release is a post-release dispute (post_release_dispute_id), NOT a state here.
        checklist_completed_at (timestamptz; the AUTHORITATIVE finish time carried on checklist_completed),
        auto_release_deadline (timestamptz; = checklist_completed_at + window; snapshot, server-swept),
        confirmed_at (nullable), released_trigger (nullable: HOST_CONFIRMED | AUTO_RELEASE),
        dispute_id (nullable; pre-release dispute → Spec 21),
        post_release_dispute_id (nullable; a dispute opened AFTER release fired → Spec 21 post-release path),
        created_at, updated_at
        (NO deleted_at; a completion is an immutable audit fact once terminal)
        │ 1:1 (created in the SAME tx as CONFIRMED/AUTO_RELEASED)
        ▼
release_intents (new — durable intent so a crash between decision and Stripe never loses the release)
        id, service_completion_id (FK CASCADE), payment_id (ref to escrow payment),
        reason (HOST_CONFIRMED | AUTO_RELEASE), status (PENDING | DISPATCHED | ACCEPTED | FAILED_RETRYABLE),
        attempt (default 0), created_at, updated_at
        -- a worker drains PENDING intents → EscrowReleaseService.release(...) (idempotent, retried)
        -- stays until Spec 9 confirms acceptance; Spec 9's single-winner release guarantees one Transfer

service_ratings (new — mutual rating, captured not gating)
        id, service_completion_id (FK → service_completions ON DELETE CASCADE),
        rater_id (FK → users ON DELETE SET NULL), ratee_id (FK → users ON DELETE SET NULL),
        role (HOST_RATES_CLEANER | CLEANER_RATES_HOST), stars (1..5), comment (nullable),
        created_at   (UNIQUE (service_completion_id, role) — one rating per side)

MONEY (Spec 9 — authoritative, NOT reimplemented here):
   EscrowReleaseService.release(paymentId, ReleaseReason.HOST_CONFIRMED | AUTO_RELEASE)
     single-winner (concurrent triggers → one Transfer), defers if payout not eligible, paused by dispute
   service-completion only CHOOSES the reason and CALLS release; it never touches Stripe/commission

COMPLETION DECISION (single-winner transitions; each release-bearing transition persists an intent IN THE SAME TX):
   AWAITING_CONFIRMATION ──(Host confirms)────────► CONFIRMED     + release_intent(HOST_CONFIRMED, PENDING)
   AWAITING_CONFIRMATION ──(deadline sweep)────────► AUTO_RELEASED + release_intent(AUTO_RELEASE, PENDING)
   AWAITING_CONFIRMATION ──(Host opens dispute)────► DISPUTED      → SUPPRESS auto-release (Spec 21 owns outcome)
   confirm vs auto-release vs dispute race → exactly one wins (conditional WHERE state=AWAITING_CONFIRMATION)
   THEN, out-of-band: release-intent worker drains PENDING → EscrowReleaseService.release(...) (idempotent, retried)
        → on Spec 9 acceptance: intent ACCEPTED; on transient failure: FAILED_RETRYABLE → retried; never lost

POST-RELEASE DISPUTE (distinct from pre-release DISPUTED):
   CONFIRMED / AUTO_RELEASED ──(Host disputes after release)──► set post_release_dispute_id → route to Spec 21
        (Spec 21 handles reversal/refund/partial per Spec 9's post-release policy; NOT a state transition here,
         NOT a Transfer reversal by service-completion)

AUTO-RELEASE (server-authoritative, durable deadline; clock from the authoritative finish time):
   checklist_completed_at = the finish timestamp CARRIED ON the checklist_completed event (not consume time)
   auto_release_deadline  = checklist_completed_at + SERVICE_AUTO_RELEASE_WINDOW_MS (snapshotted)
   a bounded repeatable sweep transitions AWAITING_CONFIRMATION past the deadline → AUTO_RELEASED (single-winner)
   a client "confirm" is the fast path; the sweep is the guarantee; a dispute before the deadline suppresses it

DURABLE EVENTS (outbox — consumed by Push/Spec 16, reputation/Spec 22):
   service_confirmed { completionId, offerId, trigger }   (HOST_CONFIRMED or AUTO_RELEASE)
   service_disputed  { completionId, offerId, disputeId } (routed to Spec 21)
   service_rated     { completionId, role, stars }

RECONCILE PATH:
   GET /service-completions/:id  → completion state + deadline + rating status (authoritative)
```

- A **completion** is a `service_completions` row bound 1:1 to a service session, created from the durable `checklist_completed` event; it holds the *decision*, references the escrow payment, and never becomes a second money ledger.
- **Release is triggered, never performed here.** A confirm/auto-release maps to a `ReleaseReason` and calls Spec 9's single-winner `release`; a dispute suppresses auto-release and hands the outcome to Spec 21.
- **The auto-release deadline is durable and server-swept**, snapshotted from config at completion creation, so a config change never moves an in-flight deadline and no client timer is trusted.
- **Ratings are captured, not gating**; a release never waits on a rating.

## Glossary

- **Completion** — a `service_completions` row: the durable decision record for finishing a service (confirmed / auto-released / disputed). Not the money ledger.
- **Confirmation** — the Host's explicit "I'm satisfied", the fast path that triggers `release(HOST_CONFIRMED)`.
- **Auto-release** — the server-swept transition when the Host neither confirms nor disputes before `auto_release_deadline`, triggering `release(AUTO_RELEASE)`.
- **Auto-release deadline** — `completed_at + SERVICE_AUTO_RELEASE_WINDOW_MS` (default 24h), snapshotted + durable + server-swept; never a client timer.
- **Dispute routing** — transitioning the completion to `DISPUTED`, which suppresses auto-release and hands the outcome to Spec 21 (which owns release/refund/partial).
- **Release trigger / ReleaseReason** — the reason (`HOST_CONFIRMED` | `AUTO_RELEASE`) passed to Spec 9's `EscrowReleaseService.release`; the escrow performs the money movement, single-winner.
- **Rating** — a `service_ratings` row: a mutual Host↔Cleaner star rating captured at completion, one per side, never gating release.
- **Single-winner transition** — a conditional write (`WHERE state = AWAITING_CONFIRMATION`) so confirm / auto-release / dispute-open resolve to exactly one outcome.

## Requirements

### Requirement 1 — A completion initialized from the checklist-completed event

**User Story:** As a Host, once the Cleaner marks the job finished, I want to be asked to confirm, so that I control when payment is released.

#### Acceptance Criteria

1. WHEN `checklist_completed` fires for a service session (Spec 19) THEN the system SHALL create exactly one `service_completions` row (`UNIQUE service_session_id`) with `state = AWAITING_CONFIRMATION`, participants + `payment_id` resolved server-side, `checklist_completed_at` taken from the **authoritative finish timestamp carried on the `checklist_completed` event** (NOT the consume time), and `auto_release_deadline = checklist_completed_at + SERVICE_AUTO_RELEASE_WINDOW_MS` snapshotted — idempotently (a redelivered event never creates a second completion). A delayed queue must not grant the Host extra time.
2. WHEN the completion is created THEN it SHALL be created off the durable `checklist_completed` event (its own consumer checkpoint), not a synchronous call from checklist-photos; a failure to create the completion SHALL NOT roll back the checklist finalize.
3. WHEN any completion endpoint is accessed THEN authorization SHALL be resolved server-side from the offer's `hostId`/`cleanerId`; a non-participant SHALL receive `403` and learn nothing.
4. WHEN no completed checklist exists for a session THEN no completion SHALL exist and no confirm/dispute SHALL be accepted.
5. WHEN more than one completion creation is attempted for the same session THEN the `UNIQUE service_session_id` constraint SHALL guarantee at most one.

### Requirement 2 — Host confirmation triggers release (single-winner)

**User Story:** As a Host, I want confirming satisfaction to release payment to the Cleaner, so that a good job is paid promptly.

#### Acceptance Criteria

1. WHEN the Host confirms satisfaction on an `AWAITING_CONFIRMATION` completion THEN the system SHALL, in a SINGLE transaction, transition `AWAITING_CONFIRMATION → CONFIRMED` via a single-winner conditional write (`WHERE state = AWAITING_CONFIRMATION`), set `confirmed_at` and `released_trigger = HOST_CONFIRMED`, AND persist a durable `release_intent { payment_id, reason: HOST_CONFIRMED, status: PENDING }`. It SHALL NOT call `EscrowReleaseService.release(...)` synchronously in the request path.
2. WHEN a release intent is `PENDING` THEN a worker SHALL drain it into `EscrowReleaseService.release(payment_id, reason)` with idempotent retries, marking the intent `ACCEPTED` once Spec 9 confirms and `FAILED_RETRYABLE` (retried) on transient failure. `service-completion` SHALL NOT itself call Stripe, recompute commission, or move money — Spec 9's release is single-winner (a concurrent/duplicate trigger yields exactly one Transfer). A process crash between the committed decision and the Stripe call SHALL be fully recoverable via the durable intent (the completion is never terminal-with-no-release-path).
3. WHEN the Cleaner's payout account is not yet eligible THEN release SHALL defer (Spec 9's deferred-payout path) without failing the confirmation; the completion is `CONFIRMED` and the payout completes when the account becomes eligible.
4. WHEN a non-participant, or the Cleaner, attempts to confirm THEN it SHALL be rejected (`403`) — only the Host confirms satisfaction.
5. WHEN confirmation is attempted on a non-`AWAITING_CONFIRMATION` completion (already CONFIRMED/AUTO_RELEASED/DISPUTED) THEN it SHALL be an idempotent no-op returning current state (if already CONFIRMED) or rejected (`409`) (if DISPUTED/terminal-different), never a second release.
6. WHEN `CONFIRMED` is reached THEN `service_confirmed { completionId, offerId, trigger: HOST_CONFIRMED }` SHALL be emitted (outbox) for push/reputation, atomically with the transition.

### Requirement 3 — Auto-release on deadline (server-authoritative, durable)

**User Story:** As a Cleaner, I want to be paid even if the Host forgets to confirm, so that my completed work is not held hostage.

#### Acceptance Criteria

1. WHEN a completion remains `AWAITING_CONFIRMATION` past its `auto_release_deadline` THEN a bounded, idempotent server sweep SHALL, in a SINGLE transaction, transition it `AWAITING_CONFIRMATION → AUTO_RELEASED` via a single-winner conditional write, set `released_trigger = AUTO_RELEASE`, AND persist a durable `release_intent { reason: AUTO_RELEASE, status: PENDING }` (drained by the same worker as Req 2.2). The sweep SHALL NOT call Stripe directly.
2. WHEN the deadline is evaluated THEN it SHALL use the snapshotted `auto_release_deadline` (derived from `checklist_completed_at`, the authoritative finish time — Req 1.1), a durable server-swept value, never a client timer and never a live config value, so neither a delayed queue nor a config change moves an in-flight deadline.
3. WHEN auto-release races with a Host confirmation or a dispute-open THEN the single-winner conditional writes SHALL ensure exactly one outcome (CONFIRMED, AUTO_RELEASED, or DISPUTED) and exactly one release trigger (or none, if disputed), never a double release.
4. WHEN the completion is `DISPUTED` before the deadline THEN the sweep SHALL NOT auto-release it (auto-release is suppressed while disputed).
5. WHEN `AUTO_RELEASED` is reached THEN `service_confirmed { completionId, offerId, trigger: AUTO_RELEASE }` SHALL be emitted (outbox), atomically with the transition.

### Requirement 4 — Dispute routing suppresses auto-release

**User Story:** As a Host, if the job was not done right, I want to raise a dispute instead of paying, so that my money is protected until it's resolved.

#### Acceptance Criteria

1. WHEN the Host opens a dispute on an `AWAITING_CONFIRMATION` completion THEN the system SHALL transition `AWAITING_CONFIRMATION → DISPUTED` via a single-winner conditional write, set `dispute_id`, and emit `service_disputed { completionId, offerId, disputeId }` (outbox) as the entry point into Spec 21.
2. WHEN a completion is `DISPUTED` THEN auto-release SHALL be suppressed (Req 3.4) and no `HOST_CONFIRMED`/`AUTO_RELEASE` trigger SHALL fire from `service-completion`; the release/refund/partial outcome is owned by dispute-system (Spec 21).
3. WHEN a dispute is opened after release already fired (completion is `CONFIRMED`/`AUTO_RELEASED`) THEN it SHALL be modeled as a **post-release dispute — a distinct concept, NOT a `CONFIRMED → DISPUTED` state transition** (the `DISPUTED` state means pre-release only). The system SHALL set `post_release_dispute_id`, emit the routing event to Spec 21 (which handles reversal/refund/partial per Spec 9's post-release policy), and SHALL NOT itself reverse the Transfer nor overload the pre-release `DISPUTED` state. The completion's terminal released state is preserved; the post-release dispute is an associated concern.
4. WHEN a non-participant, or the Cleaner, attempts to open a Host-satisfaction dispute THEN it SHALL be rejected per the dispute rules (dispute initiation authorization is defined with Spec 21; `service-completion` enforces participant gating).
5. WHEN dispute routing is emitted THEN `service-completion` SHALL NOT implement dispute resolution logic (evidence weighing, partial refunds) — that is Spec 21; it only provides the entry + the auto-release suppression guarantee.

### Requirement 5 — Ratings captured (not gating)

**User Story:** As a Host and Cleaner, I want to rate each other after the service, so that reputation is built — without it blocking payment.

#### Acceptance Criteria

1. WHEN a completion reaches `CONFIRMED` or `AUTO_RELEASED` (and only those states — rating eligibility is exactly those two in Spec 20; any rating behavior for `DISPUTED`/post-release is deferred to and defined by Spec 21) THEN each participant MAY submit exactly one rating for the other (`UNIQUE (service_completion_id, role)`), with stars 1..5 and an optional comment.
2. WHEN a rating is submitted THEN it SHALL NOT gate or delay release — a release never waits on a rating, and a Host who never rates still triggers confirm/auto-release normally.
3. WHEN a rating is submitted by a non-participant, or a duplicate for the same side, THEN it SHALL be rejected (`403`/`409`).
4. WHEN a rating is stored THEN `service_rated { completionId, role, stars }` SHALL be emitted (outbox) for reputation/favorites (Spec 22) to consume later.
5. WHEN ratings are read THEN they SHALL be participant-gated and consistent with the completion's participants.

### Requirement 6 — Mobile completion UX for both roles

**User Story:** As a Host I want to confirm or dispute and rate, and as a Cleaner I want to see that I've been paid, so that the job closes clearly.

#### Acceptance Criteria

1. WHEN the checklist is finished THEN the Host app SHALL present a confirm-satisfaction action, a dispute action, and a visible auto-release countdown (derived from the durable `auto_release_deadline`, reconciled via `GET` — the countdown is a display of the server deadline, not an authoritative client timer).
2. WHEN the Host confirms THEN the app SHALL reflect CONFIRMED and prompt for a rating; when the Host does nothing, the app SHALL reflect AUTO_RELEASED after the deadline (reconciled via `GET`).
3. WHEN the Cleaner opens the finished job THEN the app SHALL show the release status (released / pending payout / disputed) sourced from the completion + escrow state, and prompt for a rating.
4. WHEN a dispute is opened THEN the app SHALL reflect DISPUTED and hand off to the dispute flow (Spec 21), clearly indicating auto-release is paused.
5. WHEN any UI text is rendered THEN it SHALL come from i18n keys with `en`/`es` parity and follow BidClean dark design tokens.

### Requirement 7 — Configuration, security, and no hardcoded values

**User Story:** As an operator, I want completion windows and behavior driven by configuration, so that the feature is portable and safe.

#### Acceptance Criteria

1. WHEN service-completion reads any tunable (`SERVICE_AUTO_RELEASE_WINDOW_MS` (default 24h), `SERVICE_COMPLETION_SWEEP_INTERVAL_MS`, `SERVICE_COMPLETION_SWEEP_BATCH_SIZE`, rating stars min/max) THEN it SHALL come from environment/config with none hardcoded, and a fail-fast `validateServiceCompletionConfig()` SHALL run at startup for required values.
2. WHEN money-affecting decisions are made THEN service-completion SHALL only call Spec 9's release with a reason — it SHALL hold NO Stripe keys, perform NO Stripe calls, and recompute NO commission; all money authority stays in payments.
3. WHEN the auto-release window is applied THEN the deadline SHALL be snapshotted on the completion at creation, so a config change never retroactively moves an in-flight deadline.
4. WHEN completion data is handled THEN no payment secrets or PII SHALL be logged, and rating comments SHALL be treated as user content (validated/escaped, not executed).
5. WHEN a new backend module, migration, event, or mobile feature is introduced THEN it SHALL be documented (module READMEs, ARCHITECTURE diagram + a completion/release flow, CHANGELOG, and an ADR for the completion-decision-vs-escrow-authority split) per the project documentation rules.

### Requirement 8 — Persistence, lifecycle, and integrity

**User Story:** As the platform, I want completion data modeled coherently with escrow and the session, so that money decisions are auditable and never doubled.

#### Acceptance Criteria

1. WHEN the completion tables are created THEN they SHALL follow the project database standards: UUID PKs, snake_case, `timestamptz`, explicit FK `ON DELETE` behavior, application-validated `VARCHAR` for `state`/`released_trigger`/`role`/intent `reason`/`status` (not PG enums), `UNIQUE service_session_id`, `UNIQUE (service_completion_id, role)` on ratings, a `release_intents` table (with a partial index over `status = PENDING`/`FAILED_RETRYABLE` for the drain worker), a partial index over `AWAITING_CONFIRMATION` + `auto_release_deadline` for the sweep, and indexes on every FK. No `deleted_at` (audit fact).
2. WHEN a completion's parent session/offer cascades away THEN `service_completions`/`service_ratings` SHALL cascade (`service_session_id`/`offer_id`/`service_completion_id` → CASCADE); the escrow payment lifecycle is unaffected (payments is its own bounded context, referenced by id).
3. WHEN a user account is deleted THEN `host_id`/`cleaner_id`/`rater_id`/`ratee_id` SHALL be `ON DELETE SET NULL` (Spec 13 invariant — never a user-cascade); the completion + ratings are retained as audit/reputation history.
4. WHEN a completion transitions THEN each transition SHALL be an atomic single-winner conditional write with its derived fields (`confirmed_at`/`released_trigger`/`dispute_id`) and outbox event, so history never observes a CONFIRMED completion without a `released_trigger` or a double release trigger.
5. WHEN a release is triggered THEN the completion SHALL rely on Spec 9's single-winner release for money idempotency (the completion's own single-winner transition plus the escrow's single-winner release together guarantee at most one Transfer per payment), so a confirm-racing-auto-release can never double-pay.

## Correctness Properties (business invariants)

The design defines concrete, testable properties (its own numbering) mapping back to these.

- **REQ-SC1 — Completion is a session-bound decision from a durable event.** Exactly one `service_completions` per session (`UNIQUE service_session_id`), created idempotently from `checklist_completed`; inherits participant isolation; is not a second money ledger. *(Req 1.1, 1.2, 1.5)*
- **REQ-SC2 — Completion durably enqueues release, never performs it (crash-safe).** A release-bearing decision commits a durable `release_intent` in the SAME transaction; a worker drives it into Spec 9's release with idempotent retries; a crash between the committed decision and the Stripe call is fully recoverable (a terminal completion is never left with no release path). service-completion holds no Stripe keys, makes no Stripe calls, recomputes no commission. *(Req 2.1, 2.2, 7.2)*
- **REQ-SC3 — Single-winner decision + durable intent + single-winner release ⇒ no double pay & no lost release.** Confirm / auto-release / dispute-open are single-winner conditional transitions; each release-bearing one persists exactly one intent; the escrow release is itself single-winner; together at most one Transfer per payment (even under confirm-racing-auto-release) AND never a lost release under partial failure. *(Req 2.1, 2.2, 3.1, 3.3, 8.5)*
- **REQ-SC4 — Server-authoritative, durable auto-release from the authoritative finish time.** The deadline = `checklist_completed_at` (carried on the event, not consume time) + window, snapshotted + durable + server-swept, never a client timer or live config; a delayed queue never grants extra time; an unconfirmed completion always converges (auto-released) unless disputed. *(Req 1.1, 3.1, 3.2, 7.3)*
- **REQ-SC12 — Pre-release vs post-release disputes are distinct.** `DISPUTED` is pre-release only (suppresses auto-release); a dispute after release sets `post_release_dispute_id` and routes to Spec 21 without overloading `DISPUTED` or reversing the Transfer in service-completion. *(Req 4.2, 4.3)*
- **REQ-SC5 — Dispute suppresses auto-release.** A `DISPUTED` completion never auto-releases and never fires a completion-side release trigger; Spec 21 owns the outcome. *(Req 3.4, 4.1, 4.2)*
- **REQ-SC6 — Host-only confirmation/dispute.** Only the Host confirms satisfaction or opens a satisfaction dispute; the Cleaner cannot; non-participants are denied. *(Req 2.4, 4.4)*
- **REQ-SC7 — Deferred payout respected.** If the Cleaner's account is ineligible, release defers per Spec 9 without failing the completion; the payout completes on eligibility. *(Req 2.3)*
- **REQ-SC8 — Ratings captured, never gating.** One rating per side (`UNIQUE (completion, role)`); a release never waits on a rating; a missing rating never blocks confirm/auto-release. *(Req 5.1, 5.2)*
- **REQ-SC9 — Deletion coherence.** `host_id`/`cleaner_id`/`rater_id`/`ratee_id` are SET NULL (no user-cascade, Spec 13 invariant); completion + ratings retained as audit; payments unaffected (referenced by id). *(Req 8.2, 8.3)*
- **REQ-SC10 — Realtime is advisory.** Completion state + durable deadline + `GET` reconciliation are authoritative; a missed push/realtime frame never changes whether/when release fires. *(Req 6.1, 6.2)*
- **REQ-SC11 — No hardcoded config/secrets.** Auto-release window, sweep tuning, rating bounds come from config with fail-fast validation; no Stripe keys here; no PII/secrets logged; the deadline is snapshotted. *(Req 7.1–7.4)*

## Non-Goals

- Moving money, calling Stripe, recomputing commission, or reimplementing escrow release — all owned by Spec 9; service-completion only triggers release with a reason.
- Dispute resolution (evidence weighing, partial refunds, reversals) — owned by Spec 21; service-completion only routes into it and guarantees auto-release suppression.
- The cancellation-penalty ladder — a separate concern; this covers the satisfactory-finish path only.
- Gating release on ratings, or building the reputation/favorites system — ratings are captured here and consumed by Spec 22 later.
- A client-side authoritative countdown — the auto-release deadline is server-swept and durable; the client only displays it.
- Push notification delivery — service-completion emits durable events; delivery is push-notifications (Spec 16).
- Any change to the escrow, checklist, service-tracking, or offer contracts beyond creating the completion from `checklist_completed` and triggering the existing release / routing to disputes.
