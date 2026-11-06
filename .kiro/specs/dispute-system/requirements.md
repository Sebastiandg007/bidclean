# Requirements Document

## Introduction

The `dispute-system` module handles the case where a service did not go right: a Host (or, in defined cases, a Cleaner) raises a dispute, evidence is gathered, and a resolution is reached — in favor of the Cleaner, the Host, or a partial split — which then drives the escrow's existing refund/reversal machinery to move (or not move) money accordingly. It is Spec 21, the first of Sprint 6 (Polish & Extras), depending on service-completion (Spec 20, ✅) which routes disputes into it.

**It owns the dispute case and its resolution; it does not reimplement money movement.** The escrow module (Spec 9) already has the financial mechanics: `DisputeService` + `setDisputeStatus` (a `disputeStatus` of `NONE`/`OPEN` that blocks refunds/auto-release while open), the `refund-policy` (`decideRefund`, `computeProportionalReversal`) with pre-release refund vs post-release refund+proportional-reversal, ceilings, and idempotent Stripe refund/reversal calls. `dispute-system` **owns the dispute lifecycle** — open → evidence → under-review → resolved — and, on resolution, **durably enqueues the resulting financial action** (full refund / partial refund / release-to-Cleaner) which the escrow (Spec 9) executes. It never issues Stripe calls itself, never recomputes commission, and never bypasses the escrow's ceilings or idempotency. The escrow (Spec 9) remains the source of truth for money.

**It reads evidence from the specs that produced it; it does not re-derive it.** The dispute case links to the durable facts already recorded: the completed checklist + its before/after photos (Spec 19), the on-arrival video-verification result (Spec 18's `verification_flagged`/decision), the service-tracking arrival fact (Spec 17), and the Host's own submitted reason + photos. dispute-system stores references to these and lets a resolver weigh them; it never mutates the checklist, the verification, or the payment ledger directly.

**A dispute is bound to a service completion / offer, not a new payment domain.** It is created from Spec 20's routing with participants exactly the offer's `hostId`/`cleanerId`. Authorization derives from the offer, resolved server-side. Its lifecycle governs when the escrow is unblocked and which financial action is enqueued.

**Phase is determined by the actual escrow financial state, not by the completion's decision state.** A completion being `CONFIRMED`/`AUTO_RELEASED` only means a release *intent* exists (Spec 20) — the money may not yet be released. So `phase` (`PRE_RELEASE` vs `POST_RELEASE`) SHALL be derived from Spec 9's authoritative payment state (whether the escrow release has actually been accepted/executed), or an equivalent durable financial signal — never from `CONFIRMED`/`AUTO_RELEASED` as a proxy. This matters because the resolution's financial action differs: PRE_RELEASE → refund only (funds still HELD); POST_RELEASE → refund + proportional transfer-reversal (funds already paid).

**At most one active dispute per completion, not one for its lifetime.** A completion may have only one non-terminal dispute at a time, but after a dispute terminates (RESOLVED/EXPIRED) a new grievance MAY open a new dispute if policy allows — so the uniqueness constraint is over *active* disputes only.

**Authority split (kept strict):**
- **PostgreSQL is the source of truth for the dispute case + evidence references + resolution decision.** The `disputes` row (state, reason, initiator, linked completion/payment, resolution, timestamps), the `dispute_evidence` rows (typed references to checklist/photos/verification/host-submitted items), and the resolution are durable. It is not the money ledger.
- **The escrow module (Spec 9) is the source of truth for money.** `disputeStatus`, refunds, reversals, payout state all live in payments and are authoritative there. dispute-system never calls Spec 9 synchronously "after" a transition: **opening a dispute persists a durable escrow-block intent** (set `disputeStatus = OPEN`) in the same transaction as the dispute row, and a worker drives it to Spec 9 until accepted — so a crash never leaves a dispute OPEN while the escrow is still unblocked (auto-release-eligible). On resolution it durably enqueues a financial action Spec 9 executes (idempotent, ceiling-checked). **`disputeStatus` stays OPEN until Spec 9 has durably accepted the resolution's financial action; only then is NONE requested** — the escrow is never unblocked before the refund/release actually lands.
- **Money-blocked-until-settled invariant.** `disputeStatus = OPEN` means "money is protected/controlled by the dispute". It is set durably on open and cleared only after the resolution's financial effect is durably accepted by Spec 9, so there is never a window where the payment is unblocked while a resolution's refund/release has not yet been applied.
- **Upstream specs own their evidence.** Checklist/photos (Spec 19), video-verification (Spec 18), service-tracking (Spec 17) are authoritative for what they recorded; dispute-system references, never rewrites, them.
- **The resolution decision is durable and its financial effect is recoverable.** Like service-completion's release intent, a resolution commits a durable financial-action intent in the same transaction as the resolution; a worker drives it into Spec 9 with idempotent retries, so a crash never leaves a resolved dispute with no money effect.

**Deliberate scope boundaries (to keep the MVP correct and safe with money):**
- **Dispute resolution triggers escrow actions; it never moves money directly.** All Stripe interaction stays in Spec 9. dispute-system maps a resolution (favor-Cleaner / favor-Host / partial) to a durable financial-action intent (release / full refund / partial refund) that Spec 9 executes.
- **Resolution mechanism for the MVP is defined, automated evidence-scoring is not.** v1 supports a **rule-assisted manual/operator resolution** (an authorized resolver decides based on the linked evidence) and/or a **deterministic policy** (e.g. checklist-incomplete + no evidence → favor Host); it does NOT implement an AI judge or automated evidence-weighing ML. The design fixes exactly which resolution paths v1 ships.
- **Open dispute pauses auto-release and blocks refunds (reuses Spec 9).** While a dispute is `OPEN`, the escrow's existing `disputeStatus = OPEN` guard suppresses auto-release (Spec 20) and blocks ad-hoc refunds; dispute-system is the only path that resolves it.
- **Pre-release and post-release disputes both supported, mapped to Spec 9's existing paths.** Pre-release → refund-only (funds still HELD); post-release → refund + proportional transfer-reversal (funds already paid). dispute-system chooses the resolution; Spec 9's `decideRefund` computes the exact amounts + ceilings.
- **Time-bounded, never stuck.** A dispute has bounded windows (evidence submission, resolution SLA); if it stalls, a configured fallback resolution (documented — e.g. default in favor of a party, or escalate) fires via a sweep so a dispute never hangs forever and the escrow is never blocked indefinitely.
- **No public evidence exposure.** Evidence (photos, reasons) is participant + resolver gated via short-lived pre-signed URLs / references; it is not public and not shown outside the dispute's authorized viewers.
- **Correctness does not depend on realtime.** Dispute state + durable intents + `GET` reconciliation are authoritative; a missed push never changes a resolution or a financial effect.

## Domain Model Overview

```
service_completions (Spec 20) ── service_disputed (pre-release) OR post_release_dispute_id (post-release)
        │ ──► a dispute case is created for the completion / offer
        ▼
disputes (new — the durable dispute case + resolution; never the money ledger)
        id, service_completion_id (FK → service_completions ON DELETE CASCADE;
            UNIQUE PARTIAL WHERE state IN ('OPEN','UNDER_REVIEW') — one ACTIVE dispute per completion,
            not one for its lifetime; a new grievance after a terminal dispute may open a new one per policy),
        offer_id (FK → offers ON DELETE CASCADE), payment_id (ref to escrow payment, Spec 9),
        initiator_id (FK → users ON DELETE SET NULL), initiator_role (HOST | CLEANER),
        host_id / cleaner_id (FK → users ON DELETE SET NULL),
        phase (PRE_RELEASE | POST_RELEASE; derived from Spec 9's ACTUAL payment state — release accepted?
            — NOT from completion CONFIRMED/AUTO_RELEASED, which only mean a release intent exists),
        reason_code (VARCHAR, app-validated), reason_text (nullable),
        state (OPEN | UNDER_REVIEW | RESOLVED | EXPIRED),
        resolution (nullable: FAVOR_CLEANER | FAVOR_HOST | PARTIAL),
        resolution_refund_cents (nullable; the requested refund amount for FAVOR_HOST/PARTIAL — Spec 9 ceilings it),
        evidence_deadline (timestamptz; snapshot), resolution_deadline (timestamptz; snapshot),
        resolved_at (nullable), resolved_by (nullable; operator/system reference),
        created_at, updated_at   (NO deleted_at; a dispute is an immutable audit fact once terminal)
        │ 1:N
        ▼
dispute_evidence (new — typed references to durable facts; never copies the bytes)
        id, dispute_id (FK CASCADE), submitted_by (FK → users ON DELETE SET NULL),
        kind (HOST_PHOTO | HOST_REASON | CHECKLIST_REF | CHECKLIST_PHOTO_REF | VERIFICATION_REF | ARRIVAL_REF | NOTE),
          -- VISUAL kinds (HOST_PHOTO, CHECKLIST_PHOTO_REF) resolve to a short-lived pre-signed URL on read;
          -- STRUCTURED kinds (CHECKLIST_REF, VERIFICATION_REF, ARRIVAL_REF, HOST_REASON, NOTE) resolve to
          -- authorized structured data/references, NOT URLs
        ref (stable reference to the upstream record/object; visual → pre-signed URL, structured → data ref),
        created_at
        │ 1:1 (created in the SAME tx as OPEN)
        ▼
dispute_escrow_intents (new — durable escrow-block intent so open never leaves the escrow unblocked)
        id, dispute_id (FK CASCADE), payment_id, target (OPEN | NONE),
        status (PENDING | DISPATCHED | ACCEPTED | FAILED_RETRYABLE), attempt, created_at, updated_at
        -- OPEN intent persisted with dispute creation; a worker drives setDisputeStatus(OPEN) to ACCEPTED
        -- NONE intent persisted ONLY after the resolution's financial action is ACCEPTED by Spec 9
        │ 1:1 (created in the SAME tx as RESOLVED)
        ▼
dispute_financial_intents (new — durable intent so a crash never loses the money effect)
        id, dispute_id (FK CASCADE), payment_id, action (RELEASE | FULL_REFUND | PARTIAL_REFUND),
        amount_cents (nullable; for PARTIAL_REFUND), status (PENDING | DISPATCHED | ACCEPTED | FAILED_RETRYABLE),
        attempt, created_at, updated_at
        -- a worker drains PENDING → Spec 9 (EscrowReleaseService.release OR RefundService.refund),
        -- idempotent + ceiling-checked by Spec 9; stays until Spec 9 confirms acceptance

MONEY (Spec 9 — authoritative, NOT reimplemented here):
   setDisputeStatus(paymentId, OPEN|NONE)   → blocks auto-release + ad-hoc refunds while OPEN
   RefundService.refund(...)                → pre-release refund OR post-release refund + proportional reversal
   decideRefund / computeProportionalReversal → exact amounts + ceilings (integer-only)
   EscrowReleaseService.release(..., reason) → release to Cleaner (FAVOR_CLEANER)
   dispute-system only CHOOSES the resolution and DURABLY ENQUEUES the action; Spec 9 executes it

DISPUTE LIFECYCLE (single-winner transitions; escrow block is durable-intent-driven, cleared LAST):
   (create) → OPEN            + escrow_open_intent(OPEN, PENDING)  → worker → setDisputeStatus(OPEN) ACCEPTED
                                                                    → auto-release suppressed (Spec 20/9)
   OPEN     → UNDER_REVIEW    (evidence gathered / resolver engaged)
   {OPEN|UNDER_REVIEW} → RESOLVED(FAVOR_CLEANER|FAVOR_HOST|PARTIAL) + dispute_financial_intent(PENDING)
        THEN worker: financial_intent → Spec 9 applies refund/reversal/release → ACCEPTED
        ONLY THEN: escrow_open_intent(NONE, PENDING) → worker → setDisputeStatus(NONE)
        (disputeStatus stays OPEN until the financial action is durably accepted — no unblocked window)
   {OPEN|UNDER_REVIEW} → EXPIRED (SLA elapsed) → ALWAYS persist a FALLBACK resolution + financial intent
        (an EXPIRED dispute is never resolution=NULL/intent=NULL; same clear-escrow-LAST sequencing)
   every transition: UPDATE disputes SET state=:next WHERE id=:id AND state=:expected (single-winner)

RESOLUTION → FINANCIAL ACTION MAPPING (Spec 9 computes exact amounts + ceilings):
   FAVOR_CLEANER → RELEASE (pre-release: release held funds; post-release: no-op, already paid)
   FAVOR_HOST    → FULL_REFUND (pre-release: refund held; post-release: refund + proportional reversal)
   PARTIAL       → PARTIAL_REFUND(amount) (Spec 9 ceilings + proportional reversal if post-release)

RECONCILE PATH:
   GET /disputes/:id  → dispute state + evidence refs + resolution (authoritative; realtime advisory)
```

- A **dispute** is a `disputes` row bound to a service completion/offer, created from Spec 20's routing; it holds the case + resolution, references (not copies) upstream evidence, and never becomes a second money ledger.
- **Opening a dispute sets the escrow `disputeStatus = OPEN`** (via Spec 9), which reuses the existing guard to suppress auto-release and block ad-hoc refunds until resolved.
- **Resolution durably enqueues a financial action** that Spec 9 executes (release / refund / partial with ceilings + proportional reversal); a crash never leaves a resolved dispute without its money effect.
- **Never stuck:** an SLA sweep applies a configured fallback resolution so a dispute always terminates and the escrow is never blocked forever.

## Glossary

- **Dispute** — a `disputes` row: the durable case (open → under-review → resolved/expired) for a contested service. Not the money ledger.
- **Phase** — `PRE_RELEASE` (funds still HELD) or `POST_RELEASE` (funds already released), determining which Spec 9 path a resolution uses.
- **Evidence** — typed references (`dispute_evidence`) to durable facts: Host photos/reason, checklist + its photos (Spec 19), video-verification result (Spec 18), notes. Referenced, never copied.
- **Resolution** — the decision `FAVOR_CLEANER | FAVOR_HOST | PARTIAL`, mapped to a financial action executed by Spec 9.
- **Financial-action intent** — a durable `dispute_financial_intents` row (release / full refund / partial refund) drained by a worker into Spec 9 with idempotent retries; the crash-safe bridge to money.
- **disputeStatus (Spec 9)** — the escrow's `NONE`/`OPEN` flag that blocks auto-release + ad-hoc refunds while a dispute is open; set by dispute-system via Spec 9.
- **Fallback resolution** — the configured outcome applied by the SLA sweep when a dispute is not resolved within its window, so it never hangs.
- **Resolver** — the authorized actor (operator, or a deterministic policy) that decides the resolution in v1; automated ML evidence-scoring is out of scope.

## Requirements

### Requirement 1 — A dispute created from service-completion routing

**User Story:** As a Host, when a job wasn't done right, I want to open a dispute instead of paying, so that my money is protected until it's fairly resolved.

#### Acceptance Criteria

1. WHEN service-completion routes a dispute THEN the system SHALL create exactly one active `disputes` row for that completion with `state = OPEN`, `phase` derived from **Spec 9's authoritative payment state** (whether the escrow release has actually been accepted — NOT from the completion being `CONFIRMED`/`AUTO_RELEASED`, which only mean a release intent exists), participants + `payment_id` resolved server-side, and snapshotted `evidence_deadline`/`resolution_deadline` from config — idempotently (redelivery never creates a second dispute).
2. WHEN a dispute is opened THEN the system SHALL, **in the same transaction as the dispute row**, persist a durable escrow-block intent (`target = OPEN`), and a worker SHALL drive it to Spec 9's `setDisputeStatus(OPEN)` until accepted — so a crash between creating the dispute and blocking the escrow is fully recoverable and never leaves a dispute OPEN while the payment is still auto-release-eligible. The system SHALL treat the payment as truly protected once Spec 9 has accepted the OPEN transition.
3. WHEN any dispute endpoint is accessed THEN authorization SHALL be resolved server-side from the offer's `hostId`/`cleanerId` (plus an authorized resolver role); a non-participant, non-resolver SHALL receive `403` and learn nothing.
4. WHEN dispute initiation is attempted THEN the initiation rights SHALL be a **deterministic, server-enforced policy**: the **Host MAY initiate** within the dispute window on a completed/released service; the **Cleaner MAY initiate only in defined cases** — specifically a payout/non-release grievance (e.g. the Host neither confirmed nor the auto-release fired as expected, or a wrongful refund) — and SHALL NOT open a service-quality dispute against themselves. The exact allowed `(role, reason_code, phase)` combinations SHALL be config/policy-defined and enforced server-side, never client-asserted.
5. WHEN more than one dispute creation is attempted for the same completion THEN a **partial unique constraint over `state IN ('OPEN','UNDER_REVIEW')`** SHALL guarantee at most one *active* dispute per completion; after a dispute terminates (RESOLVED/EXPIRED), a new grievance MAY open a new dispute if policy allows (one active at a time, not one for the lifetime).

### Requirement 2 — Evidence gathering (references, participant-gated)

**User Story:** As a participant, I want to submit and review the evidence, so that the resolution is based on the real facts of the job.

#### Acceptance Criteria

1. WHEN the Host opens or supplements a dispute THEN the system SHALL let the Host attach a `reason_code` + optional text and photo evidence (via the same grant-gated MinIO upload pattern as checklist-photos — bytes direct to MinIO, metadata + reference in PostgreSQL), stored as `dispute_evidence` rows.
2. WHEN the dispute is created THEN the system SHALL automatically link the relevant durable upstream facts as **typed references** (never copies): `CHECKLIST_REF` + `CHECKLIST_PHOTO_REF` (Spec 19), `VERIFICATION_REF` (Spec 18), `ARRIVAL_REF` (Spec 17). Only **visual** kinds (photos) resolve to a pre-signed URL on read; **structured** kinds (checklist state, verification decision, arrival fact) resolve to authorized structured data/references, not URLs — the API SHALL NOT pretend a structured fact is a downloadable object.
3. WHEN a participant or authorized resolver views evidence THEN visual references SHALL be resolved to short-lived participant/resolver-gated pre-signed URLs and structured references to gated data; evidence SHALL never be public and never exposed outside the dispute's authorized viewers.
4. WHEN the Cleaner responds THEN the Cleaner MAY add counter-evidence (notes/photos) within the evidence window, stored the same way; both sides' evidence is preserved.
5. WHEN evidence is submitted after the `evidence_deadline` THEN it SHALL be rejected (or flagged late per config), so the resolver decides on a bounded, stable evidence set.

### Requirement 3 — Resolution (decision, then durably-enqueued escrow action)

**User Story:** As the platform, I want a dispute to reach a fair, final resolution that correctly settles the money, so that both parties are treated justly and funds never get stuck or double-moved.

#### Acceptance Criteria

1. WHEN a dispute is resolved THEN the system SHALL, in a SINGLE transaction, transition `{OPEN|UNDER_REVIEW} → RESOLVED` via a single-winner conditional write, record `resolution` (`FAVOR_CLEANER | FAVOR_HOST | PARTIAL`) + `resolution_refund_cents` (for FAVOR_HOST/PARTIAL), set `resolved_at`/`resolved_by`, AND persist a durable `dispute_financial_intent { action, amount?, status: PENDING }`. It SHALL NOT call Stripe synchronously in the request path.
2. WHEN a financial intent is `PENDING` THEN a worker SHALL drain it into Spec 9 — `EscrowReleaseService.release(...)` for FAVOR_CLEANER, `RefundService.refund(...)` for FAVOR_HOST/PARTIAL — with idempotent retries, marking it `ACCEPTED` once Spec 9 confirms; Spec 9 computes exact amounts, applies ceilings, and performs the proportional reversal for post-release phase.
3. WHEN a resolution maps to money THEN dispute-system SHALL NOT itself call Stripe, recompute commission, or bypass ceilings — Spec 9's `decideRefund`/`computeProportionalReversal` + idempotent refund/reversal own the amounts; a crash between the committed resolution and the Stripe call SHALL be fully recoverable via the durable intent.
4. WHEN a dispute is resolved THEN the escrow `disputeStatus` SHALL remain `OPEN` **until Spec 9 has durably accepted the resolution's financial action**; only THEN SHALL dispute-system enqueue an escrow-block intent with `target = NONE` to clear it. There SHALL be no window where the payment is unblocked while the resolution's refund/release has not yet landed. The resolution SHALL be final (a RESOLVED dispute is immutable; a subsequent grievance is a new dispute per policy).
5. WHEN the resolution's requested amount would violate a Spec 9 ceiling (e.g. exceeds refundable remaining) THEN Spec 9 SHALL block/clamp per its policy and the intent SHALL surface the outcome (not silently over-refund); dispute-system SHALL never override a ceiling.
6. WHEN resolution races with an SLA expiry THEN the single-winner conditional writes SHALL ensure exactly one terminal outcome (RESOLVED or EXPIRED-then-fallback), never two financial intents.

### Requirement 4 — SLA / never-stuck (bounded, fallback resolution)

**User Story:** As the platform, I want every dispute to terminate, so that a Cleaner's funds are never frozen forever and a Host is never ignored.

#### Acceptance Criteria

1. WHEN a dispute remains unresolved past its snapshotted `resolution_deadline` THEN a bounded, idempotent server sweep SHALL transition it `→ EXPIRED` (single-winner) and **always persist a concrete fallback `resolution` + its durable financial intent in the same transaction** — an `EXPIRED` dispute SHALL NEVER be left with `resolution = NULL` or no financial intent (data invariant). The fallback outcome is the **configured `DISPUTE_FALLBACK_RESOLUTION`** (documented — e.g. default in favor of a defined party, or escalate).
2. WHEN the fallback resolution is applied THEN its financial effect SHALL go through the same durable-intent → Spec 9 path (never a direct Stripe call), and the escrow `disputeStatus` SHALL be cleared to `NONE` only AFTER Spec 9 durably accepts that financial action (same clear-escrow-last sequencing as Req 3.4).
3. WHEN the deadlines are evaluated THEN they SHALL use the snapshotted `evidence_deadline`/`resolution_deadline` (durable, server-swept), never a client timer and never a live config value, so a config change never moves an in-flight dispute's clock.
4. WHEN a dispute is `EXPIRED` and its fallback applied THEN it SHALL be terminal and immutable, consistent with a RESOLVED dispute.
5. WHEN the escrow would otherwise be blocked by `disputeStatus = OPEN` THEN the SLA guarantee SHALL ensure that block is always eventually cleared by a resolution or a fallback, so `disputeStatus` never stays OPEN forever.

### Requirement 5 — Mobile dispute UX for both roles

**User Story:** As a Host I want to raise a dispute with evidence, and as a Cleaner I want to see and respond to it, so that the process is transparent and fair.

#### Acceptance Criteria

1. WHEN the Host chooses to dispute (from the completion flow, Spec 20) THEN the app SHALL let the Host pick a reason, add optional text, and attach photos (grant-gated upload), and reflect the dispute as OPEN with a visible resolution deadline (display of the durable `resolution_deadline`, reconciled via `GET`).
2. WHEN a dispute exists THEN both participants SHALL see the dispute state, the linked evidence (their own + the auto-linked checklist/verification, via participant-gated URLs), and the outcome once resolved, reconciling via `GET`.
3. WHEN the Cleaner is notified of a dispute THEN the app SHALL let the Cleaner add counter-evidence within the evidence window and show that auto-release is paused.
4. WHEN a dispute is resolved or expired THEN both apps SHALL clearly show the outcome (favor Cleaner / favor Host / partial + amount) and the resulting payment effect (released / refunded / partially refunded), sourced from the dispute + escrow state.
5. WHEN any UI text is rendered THEN it SHALL come from i18n keys with `en`/`es` parity and follow BidClean dark design tokens; evidence photos SHALL only be viewable by authorized parties.

### Requirement 6 — Configuration, security, and no hardcoded values

**User Story:** As an operator, I want dispute windows, reason codes, and fallback policy driven by configuration, so that the feature is portable, fair, and safe.

#### Acceptance Criteria

1. WHEN dispute-system reads any tunable (`DISPUTE_EVIDENCE_WINDOW_MS`, `DISPUTE_RESOLUTION_SLA_MS`, `DISPUTE_FALLBACK_RESOLUTION`, `DISPUTE_REASON_CODES`, `DISPUTE_EVIDENCE_MINIO_BUCKET`, photo size/mime/TTL/grant limits, sweep interval/batch) THEN it SHALL come from environment/config with none hardcoded, and a fail-fast `validateDisputeConfig()` SHALL run at startup for required values.
2. WHEN money-affecting decisions are made THEN dispute-system SHALL hold NO Stripe keys, perform NO Stripe calls, and recompute NO commission/ceilings — it only durably enqueues an action Spec 9 executes.
3. WHEN evidence photos are stored THEN MinIO credentials SHALL live only in server config (reusing `MINIO_*`), never shipped to the client except as time-boxed pre-signed URLs; evidence is private and gated.
4. WHEN dispute data is handled THEN no payment secrets or PII SHALL be logged, reason text SHALL be treated as user content (validated/escaped), and evidence references SHALL carry ids, not sensitive content.
5. WHEN a new backend module, migration, MinIO bucket, event, or mobile feature is introduced THEN it SHALL be documented (module READMEs, ARCHITECTURE diagram + a dispute lifecycle/resolution flow, CHANGELOG, and an ADR for the dispute-case-vs-escrow-authority split + fallback-SLA decision) per the project documentation rules.

### Requirement 7 — Persistence, lifecycle, and integrity

**User Story:** As the platform, I want dispute data modeled coherently with escrow and the completion, so that resolutions are auditable and money is never doubled or lost.

#### Acceptance Criteria

1. WHEN the dispute tables are created THEN they SHALL follow the project database standards: UUID PKs, snake_case, `timestamptz`, explicit FK `ON DELETE` behavior, application-validated `VARCHAR` for `state`/`phase`/`resolution`/`reason_code`/evidence `kind`/intent `action`/`target`/`status` (not PG enums), a **partial UNIQUE over `service_completion_id WHERE state IN ('OPEN','UNDER_REVIEW')`** (one active dispute per completion), a `dispute_escrow_intents` table AND a `dispute_financial_intents` table (each with a partial index over drainable statuses), a partial index over non-terminal `state` + `resolution_deadline` for the SLA sweep, and indexes on every FK. It SHALL enforce that an `EXPIRED`/`RESOLVED` dispute has a non-null `resolution` (data invariant). No `deleted_at` (audit fact).
2. WHEN a dispute's parent completion/offer cascades away THEN `disputes`/`dispute_evidence`/`dispute_financial_intents` SHALL cascade (`service_completion_id`/`offer_id`/`dispute_id` → CASCADE); evidence photo objects SHALL be tombstoned on cascade (voice-notes pattern) so orphaned objects are cleaned; the escrow payment is its own bounded context (referenced by id).
3. WHEN a user account is deleted THEN `initiator_id`/`host_id`/`cleaner_id`/`submitted_by` SHALL be `ON DELETE SET NULL` (Spec 13 invariant — never a user-cascade); the dispute + resolution are retained as audit history.
4. WHEN a dispute transitions THEN each transition SHALL be an atomic single-winner conditional write with its derived fields (`resolution`/`resolved_at`/`resolved_by`) and, on resolve/expire, its durable financial intent, so history never observes a RESOLVED dispute without a resolution or two financial intents for one dispute.
5. WHEN a resolution's financial effect is applied THEN it SHALL rely on Spec 9's idempotent refund/reversal/release (the dispute's single-winner resolution + the escrow's idempotency together guarantee at most one financial effect per dispute), so a resolution-racing-SLA can never double-refund.

## Correctness Properties (business invariants)

The design defines concrete, testable properties (its own numbering) mapping back to these.

- **REQ-DS1 — One active dispute per completion (not one for life).** A partial-unique over `state IN ('OPEN','UNDER_REVIEW')` allows at most one active dispute per completion, created idempotently from Spec 20's routing; a new grievance after a terminal dispute may open a new one per policy; inherits participant isolation; not a second money ledger. *(Req 1.1, 1.5)*
- **REQ-DS2 — Opening durably blocks the escrow (crash-safe).** Opening persists a durable escrow-block intent (`OPEN`) in the same tx as the dispute; a worker drives Spec 9's `setDisputeStatus(OPEN)` to acceptance, so a crash never leaves a dispute OPEN with an unblocked, auto-release-eligible payment — reusing Spec 9's guard, no new blocking mechanism. *(Req 1.2, 4.5)*
- **REQ-DS2b — Clear-escrow-last.** `disputeStatus` is cleared to `NONE` only after Spec 9 durably accepts the resolution's (or fallback's) financial action; there is never a window where the payment is unblocked while the refund/release has not landed. *(Req 3.4, 4.2)*
- **REQ-DS2c — Phase from actual financial state.** `phase` (PRE/POST_RELEASE) is derived from Spec 9's authoritative payment state (release actually accepted?), never from the completion's `CONFIRMED`/`AUTO_RELEASED` (which only mean a release intent exists). *(Req 1.1)*
- **REQ-DS3 — Evidence is referenced, not re-derived, and gated.** Checklist/photos (Spec 19), verification (Spec 18), arrival (Spec 17), and Host/Cleaner submissions are typed references resolved to short-lived participant/resolver-gated URLs; never public, never copied, never mutating upstream. *(Req 2.2, 2.3, 6.3)*
- **REQ-DS4 — Resolution durably enqueues the money effect, never performs it (crash-safe).** A resolution commits a durable financial intent in the SAME tx; a worker drives it into Spec 9's refund/reversal/release with idempotent retries; a crash between resolution and Stripe is fully recoverable. *(Req 3.1, 3.2, 3.3)*
- **REQ-DS5 — Spec 9 owns amounts + ceilings.** dispute-system chooses favor-Cleaner/Host/partial; Spec 9 computes exact refund/proportional-reversal amounts and enforces ceilings; dispute-system never overrides a ceiling or over-refunds. *(Req 3.3, 3.5)*
- **REQ-DS6 — Single-winner + idempotent escrow ⇒ no double-refund.** Resolution/expiry are single-winner conditional transitions producing at most one financial intent; Spec 9's refund/reversal is idempotent; together at most one financial effect per dispute even under resolution-racing-SLA. *(Req 3.6, 7.5)*
- **REQ-DS7 — Never stuck; EXPIRED always fully settled.** An unresolved dispute past its SLA converges to EXPIRED and ALWAYS persists a concrete fallback `resolution` + financial intent (never `resolution=NULL`/no intent), which clears the escrow block after Spec 9 accepts it; `disputeStatus` never stays OPEN forever. *(Req 4.1, 4.2, 4.5)*
- **REQ-DS8 — Server-authoritative, durable deadlines.** Evidence + resolution deadlines are snapshotted + durable + server-swept, never a client timer or live config. *(Req 4.3)*
- **REQ-DS9 — Terminal immutability.** A RESOLVED or EXPIRED dispute is immutable; a new grievance is a new dispute; the resolution is final. *(Req 3.4, 4.4)*
- **REQ-DS10 — Deletion coherence.** `initiator_id`/`host_id`/`cleaner_id`/`submitted_by` are SET NULL (no user-cascade, Spec 13 invariant); evidence objects tombstoned on cascade; dispute + resolution retained as audit; payments unaffected (referenced by id). *(Req 7.2, 7.3)*
- **REQ-DS11 — Realtime is advisory.** Dispute state + durable intents + `GET` reconciliation are authoritative; a missed push never changes a resolution or its money effect. *(Req 5.2)*
- **REQ-DS12 — No hardcoded config/secrets.** Windows, reason codes, fallback policy, buckets, limits come from config with fail-fast validation; no Stripe keys here; MinIO creds never shipped to the client; no PII/secrets logged. *(Req 6.1–6.4)*

## Non-Goals

- Moving money, calling Stripe, recomputing commission/ceilings, or reimplementing refund/reversal — all owned by Spec 9; dispute-system only chooses a resolution and durably enqueues the action.
- Automated ML evidence-scoring / an AI judge — v1 uses rule-assisted operator resolution and/or a deterministic policy; the design fixes exactly which paths ship.
- A new escrow-blocking mechanism — reuses Spec 9's `disputeStatus = OPEN`.
- Re-deriving or mutating the checklist, verification, or payment ledger — evidence is referenced, upstream specs stay authoritative.
- Public evidence exposure or a permanent evidence gallery — evidence is participant/resolver-gated and retained per policy, then cleaned up.
- A client-authoritative countdown — dispute deadlines are server-swept and durable; the client only displays them.
- Push notification delivery — dispute-system emits durable events; delivery is push-notifications (Spec 16).
- The cancellation-penalty ladder or ratings — separate concerns (service-completion / Spec 22).
- Any change to the escrow, completion, checklist, verification, or offer contracts beyond creating the dispute from routing, setting `disputeStatus`, referencing evidence, and enqueuing the resolution's financial action.
