# ADR-019: Dispute case vs. escrow authority (clear-escrow-last, dual durable intents)

## Status

Accepted

## Context

Spec 21 (`dispute-system`) closes the "the job didn't go right" loop. A Host (or, in defined cases, a Cleaner) raises a dispute over a completed service; evidence is gathered from the durable facts the service already produced (checklist/photos Spec 19, video-verification Spec 18, arrival Spec 17, plus Host/Cleaner submissions); a resolution (`FAVOR_CLEANER` / `FAVOR_HOST` / `PARTIAL`) is reached; and that resolution must drive the escrow's refund / reversal / release machinery in Spec 9.

Spec 9 (`stripe-escrow`) is already the money authority: an escrow `disputeStatus` that pauses auto-release + blocks ad-hoc refunds while `OPEN`, `decideRefund` / `computeProportionalReversal` (pre-release refund vs post-release refund + proportional reversal), ceilings, and idempotent Stripe calls. dispute-system must NOT reimplement any of that: it owns the dispute CASE + resolution and durably enqueues the action Spec 9 executes. It holds no Stripe keys and imports no Stripe SDK.

The central risks are all money-safety: a crash between a committed resolution and the Stripe call; a resolution racing an SLA expiry (double-effect); the escrow being unblocked before the refund/release actually lands; a second dispute on a payment that already had a dispute-driven effect; and losing a pending money command when the parent completion/offer cascades the dispute away.

## Decision

**1. Dispute-case-vs-escrow-authority split.** dispute-system owns the `disputes` case, its resolution, evidence references, and the two durable intents in PostgreSQL. Spec 9 owns money. dispute-system reaches Spec 9 only through a thin, injectable, mockable `EscrowClient` (`setDisputeStatus`, `releaseForDispute`, `refundForDispute`, `readPaymentPhase`) — never Stripe directly, never recomputing commission, never overriding a ceiling.

**2. Phase from one explicit Spec 9 field.** `phase` is `POST_RELEASE` iff Spec 9 `payout_status IN ('TRANSFER_CREATED','PAID')`, else `PRE_RELEASE` — derived at creation via `EscrowClient.readPaymentPhase` and snapshotted, never inferred from the completion's `CONFIRMED`/`AUTO_RELEASED` (which only mean a release intent exists) and never from a mixed accepted/executed notion.

**3. Durable-intent pattern applied twice (lease-based, crash-safe).** Opening commits an `OPEN` `dispute_escrow_intent` in the same transaction as the dispute; resolving/expiring commits exactly one `dispute_financial_intent` in the same transaction as the terminal transition. Separate lease-based workers drain each into Spec 9 with idempotent retries; a `DISPATCHED` intent orphaned by a crash is re-claimable once its `lease_until` passes.

**4. Clear-escrow-LAST.** `disputeStatus` stays `OPEN` until Spec 9 has durably APPLIED the resolution's financial action (`APPLIED` / `CEILING_CLAMPED` / accepted `NO_OP`); only then is a `NONE` escrow-block intent enqueued. There is never a window where the payment is unblocked while the refund/release has not landed.

**5. SLA sweep with a mandatory fallback resolution.** An unresolved dispute past its snapshotted `resolution_deadline` converges to `EXPIRED` with the configured `DISPUTE_FALLBACK_RESOLUTION` (never `resolution = NULL`, never intent-less), which clears the escrow after Spec 9 accepts it — so the escrow is never blocked forever.

**6. Evidence as typed references + grant-gated uploads.** Upstream facts are typed references (never byte copies), resolved on read to short-lived participant/resolver-gated pre-signed URLs (visual) or gated structured data (structured — never a URL). Host/Cleaner photos use the grant-gated MinIO pattern (grant persisted before the pre-signed PUT; finalize re-checks + server-inspects), with a `BEFORE DELETE` deletion-tombstone trigger + stale-grant cleanup (the checklist-photos/voice-notes lesson). Retention hard-deletes only TERMINAL-dispute objects past a floor validated to exceed the evidence + resolution windows plus an audit buffer.

**7. v1 resolution mechanism.** Rule-assisted operator resolution and/or a deterministic policy (the SLA fallback). No ML evidence-scoring / AI judge.

The four review decisions, recorded explicitly:

- **(1) Atomic block-vs-release in Spec 9.** `setDisputeStatus(OPEN)` atomically wins against a not-yet-accepted release on the payment aggregate: the guard lives under the `SELECT ... FOR UPDATE` in `markReleased`, so a release cannot be accepted while a dispute block is set. The OPEN-with-pending-block invariant is safe because of this atomicity, not because the block is synchronous.
- **(2) Intents survive the case via `ON DELETE SET NULL`.** Both `dispute_escrow_intents.dispute_id` and `dispute_financial_intents.dispute_id` are `ON DELETE SET NULL` (NOT cascade), with `payment_id NOT NULL`, so a cascade never destroys a pending money command; the workers key off `payment_id` + the intent row.
- **(3) BLOCKED-needs-review terminal.** A Spec 9 `BLOCKED` money effect never clears the escrow and never counts as applied — the financial intent moves to the durable `ACTION_BLOCKED` needs-review terminal (distinct from `APPLIED`/`CEILING_CLAMPED`/accepted `NO_OP`), the escrow stays `OPEN`, and the case is surfaced for operator review.
- **(4) One-financial-effect-per-payment authority in Spec 9.** A `dispute_settled_at` column on `payments` marks a payment that already had a durably applied dispute-driven effect; a second dispute-driven action is rejected with `BLOCKED` (`PAYMENT_ALREADY_SETTLED`). The at-most-one-effect-per-payment guarantee (P15) lives in Spec 9 (the money authority), not merely in the per-dispute unique constraint.

## Consequences

- **Easier:** money is never moved by dispute-system directly, never double-moved (single-winner + Spec 9 idempotency + P15 authority), never left blocked forever (SLA fallback), and never unblocked before the effect lands (clear-escrow-LAST). A crash at any point is recoverable via the two durable intents.
- **Harder / trade-offs:** the escrow block is asynchronous (a dispute may sit `OPEN` with a `PENDING` block), which is only safe because of the Spec 9 atomic block-vs-release guard — a subtlety that must be preserved. A `BLOCKED` money effect requires operator intervention (a needs-review terminal) rather than auto-closing.
- **Additive Spec 9 surface (documented in `services/api/src/dispute-system/WIRING.md`):** an `OPEN → NONE` platform-clear transition, `DisputeService.setPlatformDisputeStatus`, a new `DisputeSettlementService`, the `dispute_settled_at` column + guard, and the atomic block-vs-release guard inside `markReleased`. All additive; the Stripe `charge.dispute.*` path is untouched, and payments/service-completion/checklist test suites stay green.
