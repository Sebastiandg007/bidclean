# Requirements Document

## Introduction

The `favorites` module lets a Host mark cleaning professionals they trust as **favorites**, so that when the Host publishes an offer they can choose "offer to my favorites first" — giving those Cleaners a head start (the favorites-first window) before the offer opens to PRO and then FREE Cleaners in the radar. It is Spec 22 of Sprint 6 (Polish & Extras), depending on offer-negotiation (Spec 8, ✅) for the completed-service relationship that seeds favoriting.

**It fills a gap the offer-radar already left open.** The delivery layer (Spec 7) is already tier-aware: an offer carries a `favoritesFirst` flag, `DeliveryTier.FAVORITE` is the first tier, and the `offer-favorites-window` queue holds the offer for a configured window (default 3 min) before PRO/FREE delivery. But there is currently **no favorites relationship table, no favoriting endpoint, and no "who are this Host's favorites" resolution** that the delivery consults. This spec supplies exactly that: the durable **Host→Cleaner favorite** relationship, the CRUD to manage it, the query the delivery uses to resolve favorite Cleaners for an offer, and the count limit (unlimited for Host PRO, capped for FREE — per the plan's PRO benefits). It does **not** rebuild the tiered delivery; it feeds it.

**A favorite is a directed Host→Cleaner relationship, not a mutual/social graph.** The Host favorites a Cleaner (typically after a good service); the Cleaner does not "accept" it and is not blocked by it. It is a private list owned by the Host, used to prioritize offer delivery and (optionally) to enable a direct offer to a favorite. Authorization derives from the authenticated Host, resolved server-side.

**Authority split (kept strict):**
- **PostgreSQL is the source of truth for the favorite relationship.** The `favorites` row (host, cleaner, created_at) is the durable record and the single source the delivery consults. favorites exposes the **authoritative membership at query time**; any read cache (if introduced in design) is derived and invalidated on change. favorites does NOT promise that a `DELETE` concurrent with an in-flight delivery is atomically observed — the atomicity between "read favorite" and "emit delivery" belongs to Spec 7, not favorites (see the delivery-integration requirement).
- **offer-radar (Spec 7) owns tiered delivery AND eligibility filtering.** favorites only answers "is this Cleaner a favorite of this Host?" / "list this Host's favorite Cleaner ids"; the favorites-first window, ordering, expansion, the read↔deliver atomicity, and the Cleaner-eligibility filter (active, Cleaner role, KYC) all stay in Spec 7. favorites returns ids; Spec 7 decides who is actually deliverable.
- **subscriptions (Spec 11) owns the PRO entitlement.** favorites reads the Host's tier (via the existing subscription mirror) to apply the FREE count cap vs PRO unlimited; it never re-derives entitlement state.
- **The favorite count limit is config-driven and tier-based.** FREE Hosts have a configurable maximum number of favorites; PRO Hosts are unlimited (or a higher configurable cap). The limit is enforced server-side at add time.

**Deliberate scope boundaries (to keep the MVP correct and shippable):**
- **Host→Cleaner only in v1.** A Cleaner does not favorite Hosts, and there is no mutual match/friendship. If a Cleaner-side favorite is ever needed it is a separate directed relationship with its own spec.
- **Favorites feed delivery; they do not bypass it.** A favorite gets the favorites-first window head start (existing Spec 7 mechanic) and, optionally, the ability to receive a direct offer; a favorite never bypasses escrow, KYC, or the normal accept/negotiate flow. Being a favorite is priority, not a guaranteed match.
- **Direct-offer-to-favorite reuses the offer pipeline.** The plan's "Host → Cleaner favorite" direct offer (chat/offer before the public radar) is expressed as an offer with `favoritesFirst` targeting; favorites does not create a parallel offer path.
- **No favorite-based pricing, discounts, or auto-accept.** A favorite does not change commission, price, or auto-accept an offer; it only affects delivery priority/visibility.
- **Removing a favorite is immediate and private.** Un-favoriting is a hard delete of the relationship (favorites are disposable, not audit history — the Host's private list); the Cleaner is never notified they were removed.
- **No social exposure.** A Cleaner is not told the list of Hosts who favorited them beyond an aggregate count (if any); the Host's favorites list is private to the Host. No public "favorited by N hosts" leaderboard in v1.
- **Correctness does not depend on realtime.** The favorites relationship is a simple durable row read at publish/delivery time; there is no realtime channel or eventual-consistency concern beyond cache invalidation (if a cache is used).

## Domain Model Overview

```
users (Host) ──┐
               │  directed favorite (Host marks Cleaner)
users (Cleaner)┘
        ▼
favorites (new — the durable directed Host→Cleaner relationship)
        id, host_id (FK → users ON DELETE CASCADE), cleaner_id (FK → users ON DELETE CASCADE),
        created_at
        UNIQUE (host_id, cleaner_id)   -- a Host favorites a given Cleaner at most once
        (hard delete on un-favorite; no deleted_at — a private, disposable list, not audit history)

FAVORITE COUNT LIMIT (tier-based, config-driven, enforced at add time under a host-scoped lock):
   representation: a limit is `null` = UNLIMITED, or an `integer > 0` = capped (no magic sentinels like -1)
   FREE host  → FAVORITES_FREE_MAX (integer)
   PRO host   → FAVORITES_PRO_MAX (null = unlimited, or an integer cap)
   tier resolved from the subscriptions mirror (Spec 11); over-limit add → rejected (422) with a clear reason
   CONCURRENCY: add is (acquire host-scoped lock on host_id) → count → insert IF count < limit → release
                so concurrent adds can never exceed the cap (not a bare SELECT COUNT + INSERT)

DOWNGRADE (PRO → FREE while over the FREE cap) — non-destructive:
   a downgrade NEVER deletes existing favorites; the Host RETAINS the over-limit existing set and it
   KEEPS working for delivery; the Host simply CANNOT add new favorites until the count drops below FAVORITES_FREE_MAX

CLEANER ELIGIBILITY (favorites keeps no lifecycle logic):
   if a favorited Cleaner loses the Cleaner role / is deactivated, the favorite row is NOT auto-deleted;
   listFavoriteCleanerIds() returns ids and Spec 7 filters eligibility at delivery; the list endpoint MAY
   mark such a Cleaner "unavailable" per UX policy; if the Cleaner becomes eligible again the link reappears

CONSUMED BY offer-radar (Spec 7 — unchanged delivery, favorites only answers the query):
   at publish with favoritesFirst=true:
     delivery asks favorites: "favorite Cleaner ids for host H" → FAVORITE tier delivery for the window
   the favorites-first window / PRO / FREE tiering + expansion stay entirely in Spec 7

SEEDED BY service-completion (Spec 20 — optional convenience, not a hard dependency):
   after a CONFIRMED/AUTO_RELEASED service, the Host MAY be prompted to favorite the Cleaner
   (favorites does not require a completed service to add — the Host may favorite from a profile too,
    subject to policy — but the natural entry point is post-service)

ENDPOINTS (Host-owned, participant-gated) — one consistent idempotent semantic:
   POST   /favorites            { cleanerId }         → add → 201 (created) / 204 (already a favorite, idempotent)
                                                            / 422 (over-limit)
   DELETE /favorites/:cleanerId                       → remove (hard delete) → 204 (idempotent, incl. non-existent)
   GET    /favorites            ?limit&cursor          → the Host's favorite Cleaners (paginated)
   GET    /favorites/is-favorite/:cleanerId            → boolean (for UI toggle state)
   GET    /favorites/aggregate-count   (CLEANER-facing) → { count } of Hosts who favorited the CALLER cleaner,
                                                           only if FAVORITES_EXPOSE_AGGREGATE_COUNT=true;
                                                           NEVER the Host identities (no social graph surface)
   (internal) favorites.isFavorite(hostId, cleanerId) / listFavoriteCleanerIds(hostId) → used by delivery
   favorites NEVER persists or dispatches a direct offer; it only exposes targeting membership (Spec 7 owns offers)

RECONCILE / READ:
   GET /favorites is the authoritative list; any cache is derived + invalidated on add/remove
```

- A **favorite** is one `favorites` row: a directed Host→Cleaner relationship, unique per pair, hard-deleted on removal. It is the single source the delivery consults.
- **favorites feeds Spec 7's existing favorites-first window**; it does not reimplement tiering. Its only delivery-facing surface is "is favorite?" / "list favorite Cleaner ids".
- **The count limit is tier-based** (FREE capped, PRO unlimited), read from the subscriptions mirror, enforced at add time — never hardcoded.
- **The list is private to the Host**; a Cleaner is not notified of favorite/un-favorite and does not see who favorited them (beyond an optional aggregate count).

## Glossary

- **Favorite** — a directed Host→Cleaner relationship (`favorites` row) marking a Cleaner the Host trusts; used to prioritize offer delivery.
- **Favorites-first window** — the existing Spec 7 delivery window (default 3 min) during which only the Host's favorite Cleaners receive the offer, before PRO/FREE tiers; favorites supplies the "who".
- **Favorite count limit** — the tier-based maximum favorites a Host may hold: `FAVORITES_FREE_MAX` for FREE, unlimited/`FAVORITES_PRO_MAX` for PRO; enforced at add time.
- **Directed relationship** — Host→Cleaner only; no mutual acceptance, no Cleaner-side favorite in v1.
- **Un-favorite** — hard delete of the relationship; idempotent; the Cleaner is not notified.
- **Tier** — the Host's subscription tier (FREE/PRO) from the Spec 11 mirror, read to apply the count limit.

## Requirements

### Requirement 1 — Add a favorite (tier-limited, unique)

**User Story:** As a Host, I want to mark Cleaners I trust as favorites, so that I can offer future jobs to them first.

#### Acceptance Criteria

1. WHEN a Host adds a Cleaner as a favorite THEN the system SHALL, under a **host-scoped lock**, count the Host's favorites and insert a `favorites` row `(host_id = caller, cleaner_id)` if under the Host's tier limit — returning `201` when created and `204` when the pair already exists (idempotent, never a second row, backed by `UNIQUE (host_id, cleaner_id)`). The add SHALL NOT be a bare `SELECT COUNT + INSERT` (see Req 7.4 concurrency).
2. WHEN the Host is at their favorite count limit THEN the add SHALL be rejected with `422` and a clear reason. The limit SHALL be represented as **`null` = unlimited or an `integer > 0` = capped** (no magic sentinels): `FAVORITES_FREE_MAX` (integer) for a FREE Host, `FAVORITES_PRO_MAX` (`null` for unlimited, or an integer) for a PRO Host, with the tier read from the subscriptions mirror (Spec 11) — none hardcoded.
3. WHEN the target `cleanerId` is not a valid Cleaner (not a real user, or not a Cleaner role) THEN the add SHALL be rejected (`404`/`422`) and no row created.
4. WHEN a non-Host (or unauthenticated caller) attempts to add a favorite THEN it SHALL be rejected (`401`/`403`); only the authenticated Host manages their own list.
5. WHEN a Host attempts to favorite themselves or a non-Cleaner THEN it SHALL be rejected.
6. WHEN a Host is downgraded from PRO to FREE while holding more favorites than `FAVORITES_FREE_MAX` THEN the system SHALL NOT delete any existing favorites: the Host RETAINS the over-limit set and it continues to work for delivery, but the Host CANNOT add new favorites until their count drops below `FAVORITES_FREE_MAX`. A downgrade is never destructive.

### Requirement 2 — Remove a favorite (idempotent, private)

**User Story:** As a Host, I want to remove a Cleaner from my favorites, so that my list reflects who I currently trust.

#### Acceptance Criteria

1. WHEN a Host removes a favorite THEN the system SHALL hard-delete the `(host_id = caller, cleaner_id)` row and return `204`; removing a non-existent favorite SHALL be an idempotent no-op (`204`), never an error.
2. WHEN a favorite is removed THEN the Cleaner SHALL NOT be notified, and the removal SHALL be immediate (no soft-delete, no audit retention — the list is the Host's private, disposable data).
3. WHEN a non-owner attempts to remove another Host's favorite THEN it SHALL be rejected (`403`); a Host can only modify their own list.
4. WHEN a favorite is removed THEN any derived cache SHALL be invalidated so subsequent delivery/queries reflect the removal immediately.

### Requirement 3 — Query favorites (list + is-favorite, delivery-facing)

**User Story:** As a Host, I want to see and check my favorites, and as the platform, I want the delivery to resolve a Host's favorites, so that favorites-first delivery works.

#### Acceptance Criteria

1. WHEN a Host lists their favorites THEN the system SHALL return their favorite Cleaners (with minimal safe Cleaner display info) paginated (cursor/limit), ordered deterministically, participant-gated to the owning Host.
2. WHEN the UI checks a single relationship THEN `GET /favorites/is-favorite/:cleanerId` SHALL return a boolean for the toggle state, participant-gated.
3. WHEN offer-radar publishes an offer with `favoritesFirst = true` THEN it SHALL resolve the Host's favorite Cleaner ids via favorites (`listFavoriteCleanerIds(hostId)`) for the `FAVORITE` delivery tier; favorites SHALL expose this as a stable internal query returning **only Cleaner ids** and SHALL NOT itself perform delivery, filter eligibility, or guarantee read↔deliver atomicity — Spec 7 owns those.
4. WHEN the delivery queries favorites THEN the query SHALL be efficient (indexed on `host_id`) and return only Cleaner ids; **Spec 7 applies the eligibility filter** (active, Cleaner role, KYC) so a favorite pointing at a now-ineligible Cleaner simply is not delivered — favorites keeps no Cleaner-lifecycle logic.
5. WHEN the Host lists favorites THEN a favorited Cleaner who is currently ineligible MAY be shown as "unavailable" (per UX policy) rather than hidden; the row is never auto-deleted, and if the Cleaner becomes eligible again the link reappears automatically.
6. WHEN a Cleaner queries how many Hosts favorited them THEN `GET /favorites/aggregate-count` (the CLEANER-facing endpoint, caller = the cleaner) SHALL return only a `{ count }` and ONLY if `FAVORITES_EXPOSE_AGGREGATE_COUNT = true`; the Host identities SHALL NEVER be exposed to the Cleaner, and no other endpoint SHALL leak who favorited whom.

### Requirement 4 — Integration with delivery & completion (feeds, does not replace)

**User Story:** As a Host, I want favoriting to actually prioritize my favorites in the radar and be easy to do after a good job, so that the feature is useful in the real flow.

#### Acceptance Criteria

1. WHEN `favoritesFirst = true` and the Host has favorites THEN the existing Spec 7 favorites-first window SHALL deliver to those favorite Cleaners first; favorites SHALL NOT change the window/tier/expansion logic (it only supplies the recipient set).
2. WHEN `favoritesFirst = true` but the Host has no favorites THEN delivery SHALL proceed normally (straight to PRO/FREE) without error — an empty favorites set is valid.
3. WHEN a service completes (Spec 20 `CONFIRMED`/`AUTO_RELEASED`) THEN the Host MAY be offered to favorite the Cleaner (a convenience entry point); favorites SHALL NOT require a completed service to add (policy-configurable) and SHALL NOT be auto-created without the Host's action.
4. WHEN a favorite Cleaner is delivered an offer THEN it SHALL still go through the normal accept/negotiate/escrow/KYC flow; being a favorite SHALL NOT bypass any of those, change commission/price, or auto-accept.
5. WHEN favorites data is consumed by delivery THEN favorites SHALL expose the **authoritative membership at query time** (and invalidate any derived cache on add/remove so delivery never reads a stale cached snapshot). favorites does NOT guarantee that a `DELETE` racing an in-flight delivery is atomically observed — the read↔deliver atomicity is Spec 7's responsibility; favorites' contract is only "the query reflects committed rows at the moment it runs".

### Requirement 5 — Mobile favorites UX

**User Story:** As a Host, I want to favorite/un-favorite Cleaners and manage my list, so that I control who I prioritize.

#### Acceptance Criteria

1. WHEN a Host views a Cleaner (profile, post-service, or activity) THEN the app SHALL show a favorite toggle reflecting `is-favorite` state, with an optimistic update reconciled via the API.
2. WHEN the Host adds a favorite while at their FREE limit THEN the app SHALL show a clear message (and MAY surface a PRO upsell for unlimited favorites), never crashing or silently failing.
3. WHEN the Host manages favorites THEN the app SHALL provide a favorites list (view, remove) in the Host profile/area, paginated, with `en`/`es` parity and BidClean dark design tokens.
4. WHEN the Host publishes an offer THEN the "offer to favorites first" choice (existing radar UX) SHALL reflect whether the Host has favorites (e.g. disabled/hinted when the list is empty).
5. WHEN a favorite action fails (limit, network) THEN the UI SHALL degrade gracefully with an i18n message and revert the optimistic state.

### Requirement 6 — Configuration, security, and no hardcoded values

**User Story:** As an operator, I want favorite limits and behavior driven by configuration, so that the feature is portable and fair.

#### Acceptance Criteria

1. WHEN favorites reads any tunable (`FAVORITES_FREE_MAX` (integer), `FAVORITES_PRO_MAX` (`null`/unset = unlimited, or an integer — never a magic sentinel like -1), `FAVORITES_EXPOSE_AGGREGATE_COUNT` (bool), `FAVORITES_ALLOW_ADD_WITHOUT_SERVICE` (bool), cache TTL if used) THEN it SHALL come from environment/config with none hardcoded, and a fail-fast `validateFavoritesConfig()` SHALL run at startup for required values (incl. rejecting a negative/zero FREE cap).
2. WHEN the tier limit is applied THEN the Host's tier SHALL be read from the subscriptions mirror (Spec 11), never re-derived; favorites SHALL hold no entitlement logic of its own.
3. WHEN favorites data is handled THEN a Host SHALL only ever read/modify their own list; a Cleaner SHALL never see the identities of Hosts who favorited them; no PII beyond safe display fields SHALL be exposed.
4. WHEN a favorite references a user THEN queries SHALL be parameterized and authorization SHALL be resolved server-side from the JWT subject, never client-asserted.
5. WHEN a new backend module, migration, or mobile feature is introduced THEN it SHALL be documented (module READMEs, ARCHITECTURE diagram update if structural, CHANGELOG, and an ADR only if it introduces a notable decision) per the project documentation rules.

### Requirement 7 — Persistence, lifecycle, and integrity

**User Story:** As the platform, I want favorites modeled cleanly and coherently, so that the list is correct and cascades sanely.

#### Acceptance Criteria

1. WHEN the `favorites` table is created THEN it SHALL follow the project database standards: UUID PK, snake_case, `timestamptz` `created_at`, explicit FK `ON DELETE` behavior, `UNIQUE (host_id, cleaner_id)`, and an index on `host_id` (for the delivery list query) and on `cleaner_id` (for the aggregate count). No `updated_at`/`deleted_at` — a favorite is add-or-remove, not a mutable/audited entity.
2. WHEN either the Host or the Cleaner user is deleted THEN the `favorites` rows referencing them SHALL be `ON DELETE CASCADE` — a favorite is a live relationship, not shared history (this is a deliberate, correct use of CASCADE-from-users, unlike chat/calls/completions which preserve history via SET NULL). Deleting a user simply removes their favorite links.
3. WHEN a Cleaner changes roles or is deactivated THEN the delivery query SHALL still be safe (a favorite pointing at a now-ineligible Cleaner simply does not receive delivery); favorites need not proactively prune, but the delivery/list SHALL not error on such a row.
4. WHEN favorites are counted for the limit THEN the add SHALL run under a **host-scoped serialization** (a per-`host_id` advisory lock / transaction, not a bare `SELECT COUNT` then `INSERT`): acquire the host scope → count current favorites → insert only if `count < limit` → release. Concurrent adds for the same Host therefore CANNOT exceed the cap (a hard guarantee, not "bounded by a small amount"). PRO/unlimited skips the count check.
5. WHEN a favorite is added or removed THEN the operation SHALL be atomic and, if a cache is used, the cache SHALL be invalidated in a way that never leaves delivery reading a stale membership for correctness-relevant decisions.

## Correctness Properties (business invariants)

The design defines concrete, testable properties (its own numbering) mapping back to these.

- **REQ-FV1 — Directed, unique, private relationship.** A favorite is one directed Host→Cleaner row, unique per pair (`UNIQUE (host_id, cleaner_id)`), readable/modifiable only by the owning Host; there is no Cleaner-side favorite or mutual acceptance in v1. *(Req 1.1, 2.3, 3.1)*
- **REQ-FV2 — Tier-based limit, config-driven, entitlement not re-derived.** The limit is `null` = unlimited or `integer > 0` = capped (no sentinels); FREE = `FAVORITES_FREE_MAX`, PRO = `FAVORITES_PRO_MAX`/unlimited; tier read from the Spec 11 mirror; enforced at add time; nothing hardcoded. *(Req 1.2, 6.1, 6.2)*
- **REQ-FV11 — Downgrade is non-destructive.** A PRO→FREE downgrade over the FREE cap deletes no favorites; the over-limit set is retained and still delivers, but no new favorites can be added until the count drops below `FAVORITES_FREE_MAX`. *(Req 1.6)*
- **REQ-FV12 — Eligibility is Spec 7's job.** `listFavoriteCleanerIds` returns ids only; Spec 7 filters ineligible Cleaners at delivery; favorites keeps no Cleaner-lifecycle logic and never auto-deletes a favorite pointing at a temporarily-ineligible Cleaner (the link reappears when eligibility returns). *(Req 3.4, 3.5, 7.3)*
- **REQ-FV3 — Feeds delivery, never replaces it.** favorites only answers `isFavorite`/`listFavoriteCleanerIds`; the favorites-first window, tiering, and expansion stay in Spec 7; being a favorite never bypasses escrow/KYC/accept-negotiate, changes price/commission, or auto-accepts. *(Req 3.3, 4.1, 4.4)*
- **REQ-FV4 — Empty favorites is valid.** `favoritesFirst = true` with no favorites delivers normally (straight to PRO/FREE) without error. *(Req 4.2)*
- **REQ-FV5 — Idempotent add/remove, one consistent semantic.** Add returns `201` when created and `204` when the pair already exists (no second row); removing a non-existent favorite is an idempotent `204`; both are atomic. *(Req 1.1, 2.1, 7.5)*
- **REQ-FV6 — Private, no social exposure.** A Cleaner is never told who favorited them (at most an aggregate count if enabled); un-favorite is silent; the Host's list is private. *(Req 2.2, 3.5, 6.3)*
- **REQ-FV7 — Query reflects committed rows; cache invalidated on change.** favorites exposes authoritative membership at query time and invalidates any derived cache on add/remove; it does NOT guarantee atomicity vs an in-flight delivery — that read↔deliver atomicity is Spec 7's responsibility. *(Req 2.4, 4.5, 7.5)*
- **REQ-FV8 — Deletion coherence (CASCADE is correct here).** `host_id`/`cleaner_id` are `ON DELETE CASCADE` — a favorite is a live relationship, not shared history, so deleting a user simply removes the links (the deliberate contrast with chat/calls/completions SET NULL). *(Req 7.2)*
- **REQ-FV9 — Limit holds strictly under concurrency.** Adds run under a host-scoped lock (per-`host_id` advisory lock/transaction, not a bare COUNT+INSERT), so concurrent adds for a Host can NEVER exceed the cap — a hard guarantee, not "bounded by a small amount". *(Req 7.4)*
- **REQ-FV10 — No hardcoded config/secrets.** Limits, aggregate-count exposure, add-without-service policy, cache TTL come from config with fail-fast validation; authorization is server-side from the JWT subject; queries are parameterized. *(Req 6.1, 6.4)*

## Non-Goals

- A mutual/social favorites graph, Cleaner-side favorites, or "friend requests" — v1 is directed Host→Cleaner only.
- Rebuilding tiered delivery / the favorites-first window / radius expansion — those stay in offer-radar (Spec 7); favorites only supplies the recipient set.
- Favorite-based pricing, discounts, commission changes, or auto-accept — a favorite affects delivery priority only.
- A parallel direct-offer pipeline — a direct offer to a favorite is an offer with `favoritesFirst` targeting through the existing offer flow.
- Notifying a Cleaner of favorite/un-favorite, or exposing to a Cleaner the identities of Hosts who favorited them (at most an aggregate count).
- Soft-delete / audit history of favorites — the list is the Host's private, disposable data (hard delete, CASCADE from users).
- Auto-favoriting without the Host's explicit action.
- Any change to the offer, negotiation, escrow, or subscription contracts beyond reading the Host's tier and answering the delivery's favorites query.
