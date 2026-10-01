# favorites (Spec 22)

## Purpose

Owns the durable **directed Host→Cleaner favorite relationship** and its CRUD/query. It is the data
layer the tiered delivery (offer-radar, Spec 7) already assumes: favorites answers "is this Cleaner a
favorite of this Host?" and "list this Host's favorite Cleaner ids" (ids only). It **feeds** delivery
— it never reimplements the favorites-first window, tiering, expansion, Cleaner-eligibility filtering,
or read↔deliver atomicity (all Spec 7). The Host's favorite count limit is tier-based and config-driven
(FREE capped, PRO unlimited/capped), read from the Spec 11 `SUBSCRIPTION_TIER` contract.

## Files

| File | Responsibility |
|------|---------------|
| `favorites.constants.ts` | Env-driven config (`FAVORITES_*`), DI tokens, error strings — nothing hardcoded |
| `config/validate-favorites-config.ts` | Fail-fast startup validation (skipped under `NODE_ENV=test`) |
| `favorites.types.ts` | `FavoriteLimit`, `AddResult`, `FavoriteView`, `CursorPage`, `Paginated`, `FavoritesQuery`, `QualifyingServiceQuery` |
| `entities/favorite.entity.ts` | TypeORM mirror of the `favorites` row |
| `favorites.repository.ts` | Parameterized SQL: `addUnderLock`, delete, exists, list (keyset), listCleanerIds, countByCleaner, isCleaner |
| `favorites.cache.ts` | `FavoritesCacheService` seam + the v1 no-op pass-through (reads PostgreSQL directly) |
| `favorite-eligibility.policy.ts` | Config-driven add gate; consults the Spec 20 predicate when `FAVORITES_ALLOW_ADD_WITHOUT_SERVICE=false` |
| `favorites.service.ts` | add/remove, tier→limit resolution, cache invalidation, the delivery-facing query surface |
| `favorites.controller.ts` | Host CRUD + the opt-in Cleaner-facing aggregate-count; JWT-guarded, role-gated |
| `dto/add-favorite.dto.ts`, `dto/list-favorites-query.dto.ts` | Request validation |
| `favorites.module.ts` | Wires providers, binds seams, exports `FAVORITES_QUERY` for Spec 7 |
| `../migrations/1700000046000-CreateFavorites.ts` | The reversible `favorites` table migration |

## Dependencies

- **Consumes** `SUBSCRIPTION_TIER` (Spec 11) via `getRoleTier(hostId, HOST)` for the count limit — no
  entitlement logic of its own, no cycle (imports only the token/interface).
- **Consumes** `users`/roles for the Cleaner-role guard, the display fields, and the display-only
  `unavailable` hint. Authorization identity comes from the JWT subject.
- **Exposes** `FavoritesQuery` (`listFavoriteCleanerIds`, `isFavorite`) for offer-radar (Spec 7).
- **Consults (seam)** the Spec 20 `hasQualifyingService` predicate only when
  `FAVORITES_ALLOW_ADD_WITHOUT_SERVICE=false` (default `true` never consults it). See `WIRING.md`.

## API

All endpoints are JWT-guarded. Identity is resolved server-side (`keycloakId → userId`), never
client-asserted.

| Method | Path | Actor | Description |
|--------|------|-------|-------------|
| `POST` | `/favorites` | Host | Add `{ cleanerId }` under the host-scoped lock+limit → `201` created / `204` already / `422` over-limit / `404`\|`422` invalid Cleaner |
| `DELETE` | `/favorites/:cleanerId` | Host | Hard-delete → `204` (idempotent, incl. non-existent) |
| `GET` | `/favorites?limit&cursor` | Host | The caller's favorites, keyset-paginated, deterministic order, safe display fields + display-only `unavailable` |
| `GET` | `/favorites/is-favorite/:cleanerId` | Host | `{ isFavorite: boolean }` toggle state |
| `GET` | `/favorites/aggregate-count` | Cleaner | `{ count }` of Hosts who favorited the caller — only if `FAVORITES_EXPOSE_AGGREGATE_COUNT=true` (else `404`); never host identities |

### The add-under-limit flow (the correctness core)

Within ONE transaction:

1. `pg_advisory_xact_lock(hashtextextended(host_id, 0))` — serialize this Host's concurrent adds.
2. **Existence check FIRST** — a duplicate returns `ALREADY_EXISTS` (`204`) **before any limit check**,
   so a re-add at cap is `204`, never `422` (`ALREADY_EXISTS` strictly precedes `OVER_LIMIT`).
3. Only when capped (`limit !== null`), count and abort `OVER_LIMIT` (`422`) when `count >= limit`.
4. `INSERT ... ON CONFLICT (host_id, cleaner_id) DO NOTHING RETURNING id` (belt-and-suspenders).

PRO/unlimited (`limit === null`) skips the count. The per-`host_id` lock makes the cap a **hard**
guarantee under concurrency (never "bounded by a small amount").

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `FAVORITES_FREE_MAX` | Max favorites for a FREE Host (positive integer) | Yes |
| `FAVORITES_PRO_MAX` | Max for a PRO Host: unset/empty = unlimited (`null`), or a positive integer | No (default unlimited) |
| `FAVORITES_EXPOSE_AGGREGATE_COUNT` | Enable the Cleaner-facing aggregate-count endpoint | No (default `false`) |
| `FAVORITES_ALLOW_ADD_WITHOUT_SERVICE` | Allow favoriting without a prior completed service | No (default `true`) |
| `FAVORITES_LIST_MAX_LIMIT` | Max page size for `GET /favorites` | No (default `50`) |
| `FAVORITES_LIST_DEFAULT_LIMIT` | Default page size (must be `<=` max) | No (default `20`) |
| `FAVORITES_CACHE_TTL_MS` | Derived-cache TTL (unused by the v1 no-op cache) | No |

## Notes

- One table, hard delete, no `updated_at`/`deleted_at`. Both FKs `ON DELETE CASCADE` (a favorite is a
  live relationship, not shared history — the deliberate contrast with chat/calls/completions
  `SET NULL`). See `docs/ADR/021-favorites-host-scoped-advisory-lock.md`.
- A PRO→FREE downgrade is **non-destructive**: nothing is deleted; the over-cap set keeps delivering;
  only new adds are blocked until the count drops below the FREE cap.
- The v1 cache is a **no-op** (reads PostgreSQL = authoritative membership at query time). A future
  cache must use durable invalidation, a versioned entry with DB fallback, or be non-authoritative —
  never a bare post-commit `invalidate`.
