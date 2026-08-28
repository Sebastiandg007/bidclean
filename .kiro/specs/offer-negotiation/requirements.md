# Requirements Document

## Introduction

The offer-negotiation system is where a match is finalized between a Host and a Cleaner. After `offer-publishing` delivers an ACTIVE offer to eligible Cleaners (surfaced by `offer-radar`), a Cleaner can either **accept the offer directly** at the Host's price, or **submit a counteroffer** proposing a different price. The Host reviews incoming counteroffers and may accept, reject, or counter back. When either party accepts a price, the offer transitions ACTIVE → MATCHED through the sanctioned `OfferMatchContract` (the negotiation module never writes the offers table directly), the winning Cleaner is locked in, and all other Cleaners' radar pins for that offer are removed in real time.

This module owns the **negotiation lifecycle** (accept, counteroffer, counter-back, reject, expire) and the **acceptance revalidation** that guarantees only one Cleaner can win a given offer. It does NOT own the offer lifecycle states themselves (owned by `offer-publishing`), payment/escrow (owned by `stripe-escrow`), chat, or service tracking.

## Domain Model Overview

The negotiation domain uses three concepts. The internal data model is generic; the UX terminology is Host/Cleaner-friendly.

```
OFFER  (owned by offer-publishing — referenced by ID only)
   │ 1:N
   ▼
NEGOTIATION THREAD   (unique per offer_id + host_id + cleaner_id)
   │  status, current_proposal_id, version
   │ 1:N
   ▼
PROPOSAL   (actor = CLEANER | HOST, sequence_number, expires_at)
   status: PENDING → ACCEPTED | REJECTED | COUNTERED | SUPERSEDED | EXPIRED
   at most ONE actionable PENDING proposal per thread (DB-enforced)
   │  ACCEPTED
   ▼
OfferMatchContract.match(offerId, cleanerId, 'negotiation')  →  ACTIVE → MATCHED
```

- **Proposal** is the generic internal entity. A Cleaner's first proposal is a "counteroffer" in the UI; a Host's reply is a "counter-back". Both are Proposal rows differing only by `actor`.
- A Host MAY have multiple concurrent negotiation threads for the same offer — one per delivered Cleaner — until the offer becomes MATCHED.
- Deviation bounds for any proposed price are ALWAYS evaluated against the offer's original Host price (`offers.offered_price_cents`), never recursively against the latest proposal. This prevents a progressive walk-down that evades the limit.

## Glossary

| Term | Definition |
|------|-----------|
| Offer | A cleaning service request published by a Host, in ACTIVE state, delivered to one or more Cleaners |
| Host | Registered user with the Host role who owns the offer and reviews counteroffers |
| Cleaner | Registered user with the Cleaner role who received the offer and accepts or negotiates it |
| Negotiator | The NestJS backend module responsible for accept/counteroffer lifecycle and match finalization |
| Direct Accept | A Cleaner accepting the offer at the Host's current offered price with no price change |
| Proposal | The generic internal negotiation entity; a single price proposal made by a `CLEANER` or `HOST` actor within a thread |
| Counteroffer (UX) | A Cleaner-actor Proposal proposing a price different from the Host's offered price |
| Counter-back (UX) | A Host-actor Proposal proposing a price in response to a Cleaner's counteroffer |
| Negotiation Thread | The ordered sequence of Proposals exchanged between one Host and one Cleaner for a single offer |
| Base Price | The offer's original Host price (`offers.offered_price_cents`); the fixed reference for deviation bounds |
| Match | The finalized agreement locking one Cleaner to the offer (ACTIVE → MATCHED transition) |
| OfferMatchContract | The exposed backend contract (`OFFER_MATCH` token) that performs the ACTIVE → MATCHED transition; the only sanctioned way to match |
| Delivery Record | A row in `offer_deliveries` proving an offer was delivered (`delivery_status = 'SENT'`) to a specific Cleaner |
| Acceptance Revalidation | The server-side re-check performed at accept time (offer still ACTIVE, Cleaner has a SENT delivery, not expired, not already matched) |
| Actionable Proposal | A Proposal in PENDING status whose thread offer is still ACTIVE and whose `expires_at` has not elapsed |
| Response Window | The configured duration after which an unanswered PENDING proposal is marked EXPIRED |
| Centrifugo | The WebSocket server used to deliver real-time negotiation events to Hosts and Cleaners |
| Mobile_App | The React Native mobile application used by Hosts and Cleaners |

## Proposal State Machine

```
            create
              │
              ▼
          ┌────────┐
          │PENDING │
          └────────┘
        ┌─────┼──────┬───────────┬────────────┐
        │     │      │           │            │
     accepted │  rejected     countered   superseded / expired
        ▼     │      ▼           ▼            ▼
   ┌────────┐ │ ┌─────────┐ ┌──────────┐ ┌──────────────────────┐
   │ACCEPTED│ │ │REJECTED │ │COUNTERED │ │SUPERSEDED | EXPIRED   │
   └────────┘ │ └─────────┘ └──────────┘ └──────────────────────┘
```

- Statuses: `PENDING`, `ACCEPTED`, `REJECTED`, `COUNTERED`, `SUPERSEDED`, `EXPIRED`.
- `PENDING` is the ONLY non-terminal status. `ACCEPTED`, `REJECTED`, `COUNTERED`, `SUPERSEDED`, and `EXPIRED` are terminal and cannot transition further.
- `ACCEPTED` marks the winning proposal that produced the match (kept distinct from `SUPERSEDED` for auditability).
- `COUNTERED` marks a proposal that the counterparty replied to with a new proposal.
- `SUPERSEDED` marks a proposal invalidated by an external event (offer matched by another proposal, offer cancelled/expired, or a Direct Accept superseding an open negotiation). Carries a `superseded_reason`.
- `EXPIRED` marks a proposal whose own Response Window elapsed without a response.

## Requirements

### Requirement 1: Direct Offer Acceptance (Cleaner)

**User Story:** As a Cleaner, I want to accept an offer at the Host's price with one tap, so that I can win the job immediately without negotiating.

#### Acceptance Criteria

1. WHEN a Cleaner submits a direct acceptance for an offer, THE Negotiator SHALL revalidate that the offer is in ACTIVE state before matching.
2. WHEN a Cleaner submits a direct acceptance, THE Negotiator SHALL verify the Cleaner has a delivery record for that offer with `delivery_status = 'SENT'`.
3. IF the accepting Cleaner has no SENT delivery record for the offer, THEN THE Negotiator SHALL reject the acceptance with a forbidden error and SHALL NOT match the offer.
4. WHEN acceptance revalidation passes, THE Negotiator SHALL finalize the match by invoking the OfferMatchContract with match source `negotiation`.
5. WHEN the OfferMatchContract reports success, THE Negotiator SHALL persist the agreed price (equal to the Base Price) and its payout breakdown on the winning proposal or thread, and SHALL return the matched offer summary.
6. IF the OfferMatchContract reports failure because the offer is no longer ACTIVE, THEN THE Negotiator SHALL return a conflict error indicating the offer is no longer available.
7. WHEN a Cleaner submits a direct acceptance with a valid Idempotency-Key header, THE Negotiator SHALL return the existing result if an acceptance was already processed with the same key.
8. WHERE the accepting Cleaner has an open PENDING proposal in their thread for this offer, THE Negotiator SHALL supersede that PENDING proposal with `superseded_reason = DIRECT_ACCEPT` as part of finalizing the direct match.

### Requirement 2: Single-Winner Guarantee

**User Story:** As a Host, I want only one Cleaner to ever win my offer, so that I never accidentally commit to two cleaners for the same job.

#### Acceptance Criteria

1. WHEN two Cleaners attempt to accept the same ACTIVE offer concurrently, THE Negotiator SHALL match at most one Cleaner.
2. WHERE concurrent acceptance attempts occur, THE Negotiator SHALL rely on the OfferMatchContract's optimistic locking to serialize the ACTIVE → MATCHED transition.
3. WHEN one Cleaner has already matched an offer, THE Negotiator SHALL reject any subsequent acceptance or counteroffer-acceptance for that offer with a conflict error.
4. WHEN an offer is matched, THE Negotiator SHALL set the winning proposal to `ACCEPTED` and SHALL set all other still-PENDING proposals across all threads for that offer to `SUPERSEDED` with `superseded_reason = OFFER_MATCHED`.

### Requirement 3: Cleaner Counteroffer Submission

**User Story:** As a Cleaner, I want to propose a different price for an offer, so that I can negotiate a fair rate before committing.

#### Acceptance Criteria

1. WHEN a Cleaner submits a counteroffer, THE Negotiator SHALL revalidate that the offer is in ACTIVE state and that the Cleaner has a SENT delivery record for it.
2. WHEN a Cleaner submits a counteroffer, THE Negotiator SHALL require a proposed price that is a positive integer in the offer's currency.
3. WHEN a Cleaner submits a counteroffer, THE Negotiator SHALL validate the proposed price is within the configured allowed deviation bounds relative to the Base Price (the offer's original Host price), NOT relative to any prior proposal.
4. IF the proposed price is outside the allowed deviation bounds, THEN THE Negotiator SHALL reject the counteroffer with a validation error stating the allowed range.
5. WHEN a valid counteroffer is submitted, THE Negotiator SHALL create or reuse the single negotiation thread for the (offer, host, cleaner) combination and persist the proposal in `PENDING` status with a strictly increasing `sequence_number` within that thread.
6. WHEN a valid counteroffer is submitted, THE Negotiator SHALL compute and store the resulting Cleaner payout and Host total using the offer's snapshotted commission rates via the shared CommissionService.
7. WHEN a valid counteroffer is created, THE Negotiator SHALL set its `expires_at` to the creation time plus the configured Response Window.
8. WHERE a thread already has an actionable PENDING proposal, THE Negotiator SHALL reject a new proposal on that thread with a conflict error, enforced by a database-level partial unique constraint (at most one PENDING proposal per thread).
9. WHEN the number of proposals in a thread reaches the configured maximum, THE Negotiator SHALL reject further proposals with a limit-reached error.

### Requirement 4: Host Counteroffer Review

**User Story:** As a Host, I want to review counteroffers from Cleaners and accept, reject, or counter back, so that I stay in control of the final price.

#### Acceptance Criteria

1. WHEN a Host requests their pending counteroffers, THE Negotiator SHALL return all actionable PENDING Cleaner-actor proposals across the Host's ACTIVE offers, grouped by offer, including Cleaner identity summary, proposed price, and payout breakdown.
2. WHEN a Host accepts a Cleaner's counteroffer, THE Negotiator SHALL revalidate the offer is ACTIVE and the target proposal is still PENDING before matching.
3. WHEN a Host accepts a Cleaner's counteroffer and revalidation passes, THE Negotiator SHALL set that proposal to `ACCEPTED`, finalize the match to that Cleaner via the OfferMatchContract with match source `negotiation`, and supersede all other PENDING proposals for the offer.
4. WHEN a Host rejects a Cleaner's counteroffer, THE Negotiator SHALL set that proposal to `REJECTED` and SHALL leave the offer in ACTIVE state.
5. WHEN a Host counters back with a new price, THE Negotiator SHALL set the Cleaner's prior PENDING proposal to `COUNTERED` and persist a new Host-actor proposal in `PENDING` status with the next `sequence_number` and its own `expires_at`.
6. WHEN a Host counters back, THE Negotiator SHALL validate the counter-back price against the Base Price deviation bounds, identically to Cleaner proposals.
7. IF a Host attempts to act on a proposal for an offer they do not own, THEN THE Negotiator SHALL reject the request with a forbidden error.
8. IF a Host attempts to accept a proposal that is no longer PENDING, THEN THE Negotiator SHALL reject the request with a conflict error.
9. WHEN a Host performs any negotiation mutation with a valid Idempotency-Key header, THE Negotiator SHALL return the existing result if the same key was already processed.

### Requirement 5: Cleaner Response to Host Counter-back

**User Story:** As a Cleaner, I want to accept or decline the Host's counter-back price, so that I can close the deal or walk away.

#### Acceptance Criteria

1. WHEN a Cleaner accepts a Host counter-back, THE Negotiator SHALL revalidate the offer is ACTIVE and the Cleaner has a SENT delivery record before matching.
2. WHEN a Cleaner accepts a Host counter-back and revalidation passes, THE Negotiator SHALL set the Host proposal to `ACCEPTED`, finalize the match at the Host counter-back price via the OfferMatchContract, and supersede all other PENDING proposals for the offer.
3. WHEN a Cleaner declines a Host counter-back, THE Negotiator SHALL set that proposal to `REJECTED` and SHALL leave the offer in ACTIVE state.
4. WHERE a Cleaner declines a Host counter-back, THE Negotiator SHALL allow the Cleaner to submit a new counteroffer if the thread has not reached the configured maximum proposal count.
5. WHEN a Cleaner submits any negotiation mutation with a valid Idempotency-Key header, THE Negotiator SHALL return the existing result if the same key was already processed.

### Requirement 6: Agreed Price and Payout Consistency

**User Story:** As a Cleaner, I want the payout I see during negotiation to exactly match what I earn when matched, so that I trust the numbers.

#### Acceptance Criteria

1. WHEN any proposal is created, THE Negotiator SHALL derive Cleaner payout and Host total from the proposed price using the shared CommissionService with integer-only arithmetic.
2. THE Negotiator SHALL reuse the existing CommissionService from offer-publishing and SHALL NOT implement an independent commission calculation or rounding algorithm.
3. WHEN a match is finalized at a negotiated price, THE Negotiator SHALL persist the final agreed price and its payout breakdown on the winning (`ACCEPTED`) proposal.
4. THE Negotiator SHALL NOT alter the offer's original commission rate snapshots; it SHALL reuse the offer's `cleaner_commission_rate_bps` and `host_service_fee_rate_bps`.
5. WHERE the proposed price equals the Base Price, THE Negotiator SHALL produce the same payout breakdown as the original offer.

### Requirement 7: Real-Time Negotiation Events

**User Story:** As a Host or Cleaner, I want to see negotiation updates in real time, so that I can respond quickly without refreshing.

#### Acceptance Criteria

1. WHEN a Cleaner submits a counteroffer, THE Negotiator SHALL publish a `negotiation_proposal_created` event to the Host's negotiation channel.
2. WHEN a Host counters back, THE Negotiator SHALL publish a `negotiation_proposal_countered` event to the involved Cleaner's channel.
3. WHEN a Host or Cleaner rejects a proposal, THE Negotiator SHALL publish a `negotiation_proposal_rejected` event to the counterparty's channel.
4. WHEN a proposal is accepted and the offer is matched, THE Negotiator SHALL publish a `negotiation_proposal_accepted` event to the winning counterparty's channel.
5. WHEN an offer is matched, THE Negotiator SHALL publish an `offer_status_changed` event with state `MATCHED` to the personal channels of all other Cleaners who received the offer, so their radar pins are removed.
6. THE Negotiator SHALL include a monotonically increasing thread `version` (or proposal `sequence_number`) in every negotiation event so clients can discard out-of-order events.
7. THE Negotiator SHALL scope channels so that a Host channel receives only events for threads on the Host's own offers, and a Cleaner channel receives only events for that Cleaner's own thread and match status.
8. THE Negotiator SHALL NOT publish another Cleaner's identity or private data to Cleaners who did not win the offer.
9. WHERE a real-time publish fails, THE Negotiator SHALL NOT roll back the persisted negotiation state; the REST endpoints remain the source of truth for reconciliation.

### Requirement 8: Negotiation Expiration and Offer Terminal States

**User Story:** As a Cleaner, I want stale negotiations to close automatically when the offer is no longer available, so that I do not waste effort on dead offers.

#### Acceptance Criteria

1. WHEN an offer leaves ACTIVE state by being cancelled or expired, THE Negotiator SHALL set all PENDING proposals for that offer to `SUPERSEDED` with `superseded_reason = OFFER_EXPIRED` (offer expired) or `OFFER_CANCELLED` (offer cancelled).
2. IF a Cleaner or Host attempts to act on a proposal whose offer is no longer ACTIVE, THEN THE Negotiator SHALL reject the action with a conflict error indicating the offer state.
3. WHEN a PENDING proposal's Response Window (`expires_at`) elapses without a response, THE Negotiator SHALL mark it as `EXPIRED`.
4. THE Negotiator SHALL distinguish `EXPIRED` (the proposal's own window elapsed) from `SUPERSEDED` (invalidated by an external event), preserving the distinction for auditing and analytics.
5. THE Negotiator SHALL treat `ACCEPTED`, `REJECTED`, `COUNTERED`, `SUPERSEDED`, and `EXPIRED` as terminal proposal statuses that cannot transition further.

### Requirement 9: Quick Accept Integration (offer-radar)

**User Story:** As a Cleaner, I want the radar's Quick Accept button to actually accept the offer, so that I can win a job straight from the map or list.

#### Acceptance Criteria

1. WHEN the Cleaner taps Quick Accept in the radar preview sheet, THE Mobile_App SHALL invoke the negotiation direct-acceptance action for the selected offer.
2. THE Mobile_App SHALL disable Quick Accept when the device is offline, because acceptance requires server-side revalidation.
3. WHEN a Quick Accept succeeds, THE Mobile_App SHALL reflect the matched state and remove the offer from the radar's active set.
4. IF a Quick Accept fails because the offer is no longer available, THEN THE Mobile_App SHALL surface a non-blocking message and remove the stale offer from the radar.
5. THE Mobile_App SHALL NOT perform any client-side eligibility decision; it SHALL rely entirely on the negotiation backend's revalidation result.

### Requirement 10: Cleaner Negotiation UI

**User Story:** As a Cleaner, I want a clear screen to accept or counter an offer and track my proposal, so that negotiating is simple.

#### Acceptance Criteria

1. THE Mobile_App SHALL present, on the offer detail screen, an "Accept" action at the Host's price and a "Counteroffer" action.
2. WHEN the Cleaner opens the counteroffer input, THE Mobile_App SHALL display the live payout that results from the entered price using the offer's commission rates.
3. THE Mobile_App SHALL prevent submitting a counteroffer price outside the allowed deviation bounds (relative to the Base Price) and SHALL show the allowed range.
4. WHILE a Cleaner has a PENDING proposal, THE Mobile_App SHALL show its status and the Host's response when it arrives.
5. WHERE a Cleaner has a PENDING counteroffer, THE Mobile_App SHALL still allow Direct Accept at the Host's price, communicating that doing so supersedes the open counteroffer.
6. THE Mobile_App SHALL localize all negotiation UI text via i18n keys and SHALL format all prices per the user's locale and the offer currency.

### Requirement 11: Host Negotiation UI

**User Story:** As a Host, I want an inbox of counteroffers with accept/reject/counter actions, so that I can manage negotiations quickly.

#### Acceptance Criteria

1. THE Mobile_App SHALL present the Host a list of incoming counteroffers grouped by offer, each showing proposed price, resulting Host total, and a Cleaner summary.
2. THE Mobile_App SHALL provide Accept, Reject, and Counter actions on each PENDING counteroffer.
3. WHEN the Host enters a counter-back price, THE Mobile_App SHALL display the resulting Host total and Cleaner payout before submission and SHALL enforce the Base Price deviation bounds.
4. WHEN a counteroffer is accepted, THE Mobile_App SHALL reflect the matched offer and remove all counteroffers for that offer from the pending inbox.
5. THE Mobile_App SHALL update the inbox in real time as new counteroffers arrive, using event version/sequence to render updates in order.

## Non-Functional Requirements

### Correctness Properties

- **P1 — Single winner:** Exactly one Cleaner can match a given offer; concurrent acceptances never produce two matches.
- **P2 — Money integrity:** Payout and Host total are always derived by integer-only arithmetic via CommissionService; no floating-point currency math.
- **P3 — Match payout consistency:** A negotiated match's persisted payout breakdown exactly equals the breakdown computed from its agreed price and the offer's snapshotted rates.
- **P4 — One pending proposal:** A negotiation thread never has more than one actionable PENDING proposal (DB-enforced).
- **P5 — Proposal ordering:** Proposal `sequence_number` values are strictly increasing within a thread.
- **P6 — Terminal immutability:** A terminal proposal (ACCEPTED/REJECTED/COUNTERED/SUPERSEDED/EXPIRED) never transitions to another state.
- **P7 — Authorization:** A user can only act on negotiation threads they own (Host) or participate in (Cleaner).
- **P8 — Offer state gate:** No negotiation action succeeds when the offer's state is not ACTIVE.
- **P9 — Idempotency:** Repeating the same idempotent request produces the same result and never creates duplicate proposals or matches.
- **P10 — Match supersession:** Once an offer is MATCHED, all other PENDING proposals for it become non-actionable (SUPERSEDED).
- **P11 — Deviation reference stability:** Deviation bounds are always evaluated against the immutable Base Price, never against a prior proposal.

### Security
- All negotiation endpoints require JWT authentication.
- Cleaner-only actions (accept, counteroffer) reject non-Cleaner roles; Host-only actions (accept counteroffer, reject, counter-back) reject non-owning users.
- The negotiation module never writes the `offers` table directly; matching is exclusively performed via the OfferMatchContract.
- Losing Cleaners never receive the winning Cleaner's identity or private data; channel scoping enforces this.

### Performance
- Accept revalidation and match finalization respond within 300 ms p95 under normal load.
- Real-time negotiation events reach the counterparty within 1 second of the triggering action.

### Reliability
- Real-time publish failures do not corrupt persisted negotiation state; REST endpoints remain authoritative for reconciliation.
- All negotiation mutations are idempotent per Idempotency-Key so client retries never double-process.

### Internationalization
- All negotiation UI text uses i18n keys (no hardcoded strings).
- Prices display in the offer currency, formatted per user locale (COP, USD, CAD, EUR, GBP).

## Dependencies

- **offer-publishing (Spec 6):** offer state machine, `offers` and `offer_deliveries` tables, `CommissionService`, and the `OfferMatchContract` (`OFFER_MATCH` token) for ACTIVE → MATCHED. NOTE: the existing `OfferMatchContract` returns `{ success, reason? }`; negotiation does NOT change this contract and persists agreed-price data in its own tables.
- **offer-radar (Spec 7):** Quick Accept delegation (req 7.4, 7.5, 11.2), radar offer store, and `offer_status_changed` event consumption.
- **user-roles (Spec 2):** Host and Cleaner role enforcement.
- **Centrifugo:** WebSocket transport for real-time negotiation events.
- **Zustand:** Mobile negotiation state management.

## Out of Scope

- The offer lifecycle transitions other than triggering ACTIVE → MATCHED (owned by offer-publishing).
- Payment authorization, escrow hold, and release (owned by stripe-escrow).
- Chat or messaging between Host and Cleaner (owned by realtime-chat).
- Service tracking, check-in, or completion (owned by service-tracking / service-completion).
- Push notification infrastructure (owned by push-notifications; negotiation only emits domain events others may consume).
- Cleaner availability or work zone configuration (owned by user-profile).
