# ADR-021: Favorites — host-scoped advisory lock for the count cap, and CASCADE-from-users

## Status

Accepted

## Context

Spec 22 (`favorites`) introduces a directed Host→Cleaner favorite relationship with a tier-based count
limit (FREE capped, PRO unlimited/capped). Two design decisions are notable enough to record:

1. **Enforcing the count cap under concurrency.** A naive `SELECT COUNT(*)` followed by `INSERT` is a
   classic check-then-act race: two concurrent adds for the same Host can both read a below-limit
   count and both insert, exceeding the cap. The requirement (REQ-FV9) is a **hard** guarantee — the
   cap can never be exceeded, not merely "bounded by a small amount."

2. **What happens to favorites when a referenced user is deleted.** The sibling modules (chat, calls,
   completions) deliberately preserve history with `ON DELETE SET NULL` because their rows are shared
   audit facts. A favorite is different: it is a *live, private relationship*, not history.

## Decision

1. **Add under a host-scoped PostgreSQL advisory lock, not a bare COUNT+INSERT.** The `addUnderLock`
   transaction acquires `pg_advisory_xact_lock(hashtextextended(host_id, 0))` first, then checks
   existence, then (only when capped) counts and inserts, all in one transaction with the lock held to
   commit. This serializes concurrent adds **per Host** (no global lock, contention scoped to one
   Host), so the count check and insert are race-free. Ordering inside the lock is deliberate:
   **existence check precedes the limit check**, so a re-add of an existing favorite returns `204`
   (idempotent) even when the Host is at cap — a duplicate never surfaces as `422`. An
   `INSERT ... ON CONFLICT (host_id, cleaner_id) DO NOTHING` remains as a belt-and-suspenders guard.

   Rejected alternatives: `SERIALIZABLE` transactions with retry (more complex, broader abort surface)
   and a denormalized stored counter (adds drift to keep in sync).

2. **Both FKs are `ON DELETE CASCADE`.** Deleting either the Host or the Cleaner simply removes their
   favorite links. This is the correct, deliberate exception to the platform's usual
   `SET NULL`-preserves-history rule, because a favorite is a live relationship — there is no audit
   value in a dangling favorite pointing at a deleted user.

## Consequences

- **Easier:** the cap is a hard guarantee under any concurrency without a global lock or a counter to
  reconcile; the idempotent CRUD semantics fall out cleanly (duplicate-before-limit ordering); user
  deletion needs no favorites-side cleanup job (the DB cascades).
- **Harder / trade-offs:** every add takes a per-Host advisory lock (negligible — contention is scoped
  to a single Host's concurrent adds, which is rare); the CASCADE means a favorite is genuinely
  disposable data with no recovery, which is intended (the list is the Host's private, non-audited
  data). A PRO→FREE downgrade is explicitly **non-destructive**: the cap is evaluated only at add time,
  so an over-cap Host retains and keeps delivering their full set and is only blocked from adding more.
- favorites keeps **no** Cleaner-lifecycle logic: `listFavoriteCleanerIds` returns ids even for an
  ineligible Cleaner; Spec 7 owns eligibility filtering. The row is never auto-pruned.
