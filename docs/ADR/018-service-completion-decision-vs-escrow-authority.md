# ADR-018: Service-completion decision vs. escrow authority (durable release intent)

## Status

Accepted

## Context

Spec 20 (`service-completion`) closes the service loop: after the Cleaner finalizes the checklist
(Spec 19's `checklist_completed`), the Host confirms satisfaction (releasing the escrowed payment),
does nothing (an auto-release fires after a configured window), or opens a dispute (Spec 21, which
pauses auto-release). The escrow (Spec 9) is already the source of truth for money:
`EscrowReleaseService.release(paymentId, ReleaseReason)` performs the Stripe Transfer, is
single-winner (concurrent triggers → one Transfer), defers the payout when the Cleaner is not
`payouts_enabled`, and is paused while a dispute is `OPEN`.

The central risk is money safety across three failure surfaces: (1) a process crash between
committing a terminal completion decision and issuing the Stripe call would leave a completion
terminal with the escrow un-triggered; (2) concurrent triggers (confirm racing auto-release racing
dispute) must never double-pay; (3) a dispute raised after release already fired must not be
conflated with the pre-release `DISPUTED` state nor reverse the Transfer here.

## Decision

- **Completion owns the WHEN/decision; the escrow owns the HOW/money.** `service-completion` never
  holds Stripe keys, never calls Stripe, and never recomputes commission. It maps a decision to a
  `ReleaseReason` (`HOST_CONFIRMED` | `AUTO_RELEASE`) and relies on Spec 9's single-winner release.
- **Durable release-intent pattern (crash-safe).** In the SAME transaction as the terminal decision
  (`CONFIRMED`/`AUTO_RELEASED`), a `release_intent { payment_id, reason, status: PENDING }` is
  persisted. `service-completion` NEVER calls `release()` synchronously in the request/sweep path. A
  separate `ReleaseIntentWorker` drains PENDING intents into `EscrowReleaseService.release(...)` with
  idempotent retries. A crash after the committed decision but before the Stripe call is fully
  recoverable — a terminal completion can never be left with no release path.
- **Lease-based `DISPATCHED` reclaim.** The worker claims an intent via a single-winner conditional
  UPDATE that sets `status='DISPATCHED', dispatched_at, lease_until = now + LEASE_MS`. An intent
  orphaned `DISPATCHED` by a crash is durably re-claimable once its `lease_until` elapses; the
  re-driven `release(...)` is a Spec-9 no-op (at most one Transfer). The lease MUST exceed the drain
  interval (fail-fast validated) so a live, in-flight dispatch is never stolen.
- **`ACCEPTED` = release COMMAND accepted, not funds settled.** An intent is `ACCEPTED` when Spec 9
  durably accepted the release command; a deferred payout (`payout_status = PENDING` when
  `payouts_enabled = false`) is still `ACCEPTED`. The Cleaner UI's released / pending-payout /
  disputed distinction reads the server-derived `release_status` (`NOT_TRIGGERED`/`PENDING`/`ACCEPTED`).
- **Single-winner everywhere + Spec 9 single-winner ⇒ at most one Transfer.** Confirm / auto-release
  / dispute-open are conditional writes (`WHERE state='AWAITING_CONFIRMATION'`); exactly one wins.
  `uq_release_intents_completion` caps intents at one per completion. Combined with Spec 9's
  single-winner release, at most one Transfer per payment even under a three-way race, and never a
  lost release under partial failure.
- **Server-authoritative, snapshotted auto-release deadline from the authoritative finish time.** The
  deadline = `checklist_completed_at + SERVICE_AUTO_RELEASE_WINDOW_MS`, snapshotted at creation and
  swept by a bounded, single-winner server sweep. `checklist_completed_at` is the run's finish time
  carried on `checklist_completed` (Spec 19's `completed_at`), an **additive, backward-safe** payload
  extension mirroring how Spec 19 extended `service_started`. A missing `completedAt` (pre-extension
  event) is rejected so the deadline is never anchored to a non-authoritative consume time.
- **Pre-release `DISPUTED` vs post-release `post_release_dispute_id`.** `DISPUTED` is pre-release only
  (reachable solely from `AWAITING_CONFIRMATION`; suppresses auto-release; no intent). A dispute after
  release sets `post_release_dispute_id` and routes to Spec 21 **only when `release_status = ACCEPTED`**
  (money actually moved); while the intent is still `PENDING`/`DISPATCHED` it is a pre-release concern
  → `409` (release not yet executed). It never overloads `DISPUTED`, never reverses the Transfer, and
  preserves the terminal released state.
- **The `release_intent` is a durable financial command that survives completion deletion.**
  `release_intents.service_completion_id` is `ON DELETE SET NULL` (NOT `CASCADE`): if the parent
  session/offer cascades the completion away while the intent is un-`ACCEPTED`, the intent is retained
  (its FK nulled) and — carrying its own `payment_id`/`reason` — still completes via the worker, so
  the release path is never lost. Ratings (audit/reputation data) still cascade with the completion;
  user FKs are `SET NULL` (Spec 13 invariant).

## Consequences

- **Easier:** money safety is provable — no synchronous Stripe call in the hot path, crash recovery
  is a durable-intent + lease invariant, and double-pay is impossible by construction (single-winner
  decision × single-winner release). The decision store and the money ledger stay cleanly separated.
- **Harder / trade-offs:** the release is eventually consistent — a `CONFIRMED` completion may show
  `release_status = PENDING` briefly until the worker drives it to `ACCEPTED`. Downstream (post-release
  disputes, the Cleaner "paid" state) must gate on `ACCEPTED`, not on the decision state. An extra
  table (`release_intents`) and a worker are introduced, and the `checklist_completed` payload gains a
  field (backward-safe). We accept these for correctness with money.
- **Alternative considered:** cascading `release_intents` with the completion (option A) or blocking
  the completion delete while an un-`ACCEPTED` intent exists (option C). Both couple the completion's
  deletability to Spec 9's async progress and risk a lost release path; we chose SET NULL + retain
  (option B).
