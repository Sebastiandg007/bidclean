# Implementation Plan: Favorites

## Overview

`favorites` (Spec 22) supplies the durable directed **Host→Cleaner favorite relationship** the tiered delivery already assumes: it owns exactly one table (`favorites`) and exposes two delivery-facing queries (`listFavoriteCleanerIds(hostId)` ids-only, `isFavorite(hostId, cleanerId)`) plus Host CRUD and an opt-in Cleaner-facing aggregate-count. It feeds offer-radar (Spec 7) — it does NOT reimplement the favorites-first window, tiering, expansion, Cleaner-eligibility filtering, or read↔deliver atomicity. It reads the Host tier via the Spec 11 `SUBSCRIPTION_TIER` contract (`getRoleTier(hostId, HOST)`), consults Spec 20's `hasQualifyingService(hostId, cleanerId)` predicate for the add-eligibility gate, and consumes a shared user/role/KYC eligibility reader for a display-only `unavailable` hint — owning none of that logic.

Implementation is bottom-up: environment/config + fail-fast validation first, then schema + reversible migration, then types/entity, then the repository (the corrected `addUnderLock` ordering under a host-scoped advisory lock), then the cache seam, then the eligibility policy, then the service (tier→limit resolution + policy gate + cache invalidation), then the controller + module wiring (exposing the `FavoritesQuery` token to Spec 7), then mobile (SDK-free: Zustand store + optimistic toggle + screens + i18n), followed by property-based, unit, DDL/migration, integration, and mobile tests, and finally documentation.

The correctness core is the **add-under-limit** decision: acquire `pg_advisory_xact_lock(hashtextextended(host_id))` → **check existence FIRST** (a duplicate returns `204` even at cap, before any limit check) → if capped, count and abort `422` when `count >= limit` → else `INSERT ... ON CONFLICT (host_id, cleaner_id) DO NOTHING` (`201`). This ordering makes duplicate-at-cap a `204` (never `422`) and keeps the cap a hard guarantee under concurrency.

Coupling is one-directional and cycle-free: `favorites` imports only the Spec 11 token/interface, the Spec 20 qualifying-service predicate, the users/roles read, and the shared eligibility reader; Spec 7 depends on the `FavoritesQuery` token exposed here.

## Tasks

- [ ] 1. Environment configuration & constants
  - [ ] 1.1 Add favorites environment variables to `.env.example`
    - Add `FAVORITES_FREE_MAX` (positive integer, required), `FAVORITES_PRO_MAX` (unset/empty = unlimited, or positive integer), `FAVORITES_EXPOSE_AGGREGATE_COUNT` (bool, default false), `FAVORITES_ALLOW_ADD_WITHOUT_SERVICE` (bool, default true), `FAVORITES_LIST_MAX_LIMIT` (positive integer, default 50), `FAVORITES_CACHE_TTL_MS` (positive integer, optional/unused by no-op cache)
    - Document that no favorite limit is a magic sentinel (`null`/unset = unlimited; no `-1`)
    - _Requirements: 6.1_
  - [ ] 1.2 Create favorites constants with fail-fast startup validation
    - Create `services/api/src/favorites/favorites.constants.ts`: parse the `FAVORITES_*` values via `ConfigService`; expose typed constants (no hardcoded caps in logic)
    - Create `services/api/src/favorites/config/validate-favorites-config.ts`: `validateFavoritesConfig()` throws (fail-fast, skipped under `NODE_ENV=test`) iff `FAVORITES_FREE_MAX` is absent/non-integer/`<= 0`, `FAVORITES_PRO_MAX` is present but not a positive integer, a boolean flag is malformed, `FAVORITES_LIST_MAX_LIMIT <= 0`, or `FAVORITES_CACHE_TTL_MS <= 0` when set
    - _Requirements: 6.1, 6.2 — Property 11 (REQ-FV2, REQ-FV10)_

- [ ] 2. Backend — Database Schema & Migration
  - [ ] 2.1 Create the favorites table migration (reversible)
    - Create `services/api/src/database/migrations/1700000019000-CreateFavorites.ts` with `up()`/`down()`, `IF NOT EXISTS`
    - Table `favorites`: `id UUID PK DEFAULT gen_random_uuid()`, `host_id UUID NOT NULL`, `cleaner_id UUID NOT NULL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`; NO `updated_at`/`deleted_at`
    - Constraints: `uq_favorites_host_cleaner UNIQUE (host_id, cleaner_id)`, `chk_favorites_not_self CHECK (host_id <> cleaner_id)`, both FKs `REFERENCES users(id) ON DELETE CASCADE`
    - Indexes: `idx_favorites_host (host_id)`, `idx_favorites_cleaner (cleaner_id)`, `idx_favorites_host_created (host_id, created_at DESC, id DESC)`
    - Table + column comments per database-standards
    - _Requirements: 7.1, 7.2 — REQ-FV1, REQ-FV8_

- [ ] 3. Backend — Types & Entity
  - [ ] 3.1 Create favorites types
    - Create `favorites.types.ts`: `FavoriteLimit` (`number | null`), `AddResult` (`CREATED`|`ALREADY_EXISTS`|`OVER_LIMIT`), `FavoriteView` (cleanerId, displayName, avatarUrl, favoritedAt, display-only `unavailable`), `CursorPage`, `Paginated<T>`, and the internal query result types
    - Define the `FavoritesQuery` interface (`listFavoriteCleanerIds(hostId)`, `isFavorite(hostId, cleanerId)`) + its injection token
    - _Requirements: 3.1, 3.3, 3.5 — REQ-FV1, REQ-FV3, REQ-FV12_
  - [ ] 3.2 Create the favorite entity
    - Create `entities/favorite.entity.ts` matching the migration; JSDoc on every column; timezone-aware `created_at`; auto-discovered by the `**/*.entity.ts` glob
    - _Requirements: 7.1_

- [ ] 4. Backend — Repository (parameterized SQL)
  - [ ] 4.1 Implement FavoritesRepository.addUnderLock (corrected ordering)
    - Create `favorites.repository.ts`; implement `addUnderLock(hostId, cleanerId, limit)` in ONE transaction: `pg_advisory_xact_lock(hashtextextended($hostId))` → **existence check FIRST** (`SELECT EXISTS(... WHERE host_id=$h AND cleaner_id=$c)`) returning `ALREADY_EXISTS` before any limit check (so duplicate-at-cap is `204`) → if `limit !== null`, `SELECT count(*) WHERE host_id=$h` and abort `OVER_LIMIT` when `count >= limit` → else `INSERT ... ON CONFLICT (host_id, cleaner_id) DO NOTHING RETURNING id` (belt-and-suspenders); returns `CREATED`/`ALREADY_EXISTS`/`OVER_LIMIT`; PRO/unlimited (`limit === null`) skips the count
    - _Requirements: 1.1, 1.2, 7.4 — Property 1, Property 2 (REQ-FV5, REQ-FV9)_
  - [ ] 4.2 Implement the remaining repository queries
    - `deleteFavorite(hostId, cleanerId)` idempotent hard delete; `existsFavorite(hostId, cleanerId)`; `listByHost(hostId, limit, cursor)` keyset pagination on `(created_at DESC, id DESC)` joining minimal safe Cleaner display fields + the display-only `unavailable` hint from the shared user/role/KYC eligibility reader (consumed, not owned); `listCleanerIds(hostId)` ids-only via `idx_favorites_host`; `countByCleaner(cleanerId)` via `idx_favorites_cleaner`; `isCleaner(userId)` delegating the Cleaner-role guard to the users/roles read
    - All parameterized SQL; no string concatenation
    - _Requirements: 2.1, 3.1, 3.3, 3.4, 3.5, 3.6, 6.4 — Property 3, 4, 6, 8, 9 (REQ-FV3, REQ-FV6, REQ-FV12)_
  - [ ]* 4.3 Unit tests for repository invariants
    - `addUnderLock`: existence-before-limit (duplicate at cap → `ALREADY_EXISTS`, not `OVER_LIMIT`); `OVER_LIMIT` only for a genuinely new pair at/over cap; unlimited skips count; `ON CONFLICT DO NOTHING`; `deleteFavorite` idempotent; `listByHost` deterministic keyset + safe fields; `listCleanerIds` ids-only; `countByCleaner` uses the cleaner index
    - _Requirements: 1.1, 1.2, 2.1, 3.1, 3.3 — Property 1, 3, 4, 8_

- [ ] 5. Backend — Cache seam & eligibility policy
  - [ ] 5.1 Implement FavoritesCacheService (no-op pass-through default)
    - Create `favorites.cache.ts`: `FavoritesCacheService` interface (`getCleanerIds` → `null` miss, `set` no-op, `invalidate` no-op); default binding always reads PostgreSQL (authoritative membership at query time)
    - Document the future-cache constraint: a real cache MUST use durable invalidation (outbox), a versioned entry with DB fallback, or be treated as non-authoritative — never rely on a bare post-commit `invalidate` for freshness
    - _Requirements: 2.4, 4.5, 7.5 — Property 3 (REQ-FV7)_
  - [ ] 5.2 Implement FavoriteEligibilityPolicy (config-driven add gate)
    - Create `favorite-eligibility.policy.ts`: `assertMayAdd(hostId, cleanerId)`; when `FAVORITES_ALLOW_ADD_WITHOUT_SERVICE === true` resolve to allow (no external read); when `false` consult Spec 20's `hasQualifyingService(hostId, cleanerId)` predicate (imported contract, never re-derived) and throw `422` with a clear reason when it is `false`
    - _Requirements: 4.3, 6.1 — Property 12 (REQ-FV3, REQ-FV10)_
  - [ ]* 5.3 Unit tests for cache + eligibility policy
    - No-op cache misses + no-ops; a cache-under-test invalidates on every add/remove; policy allows unconditionally when flag `true`, gates on the stubbed `hasQualifyingService` when `false` (`422` when false, allow when true); policy owns no completion logic
    - _Requirements: 4.3, 6.1 — Property 12_

- [ ] 6. Backend — FavoritesService
  - [ ] 6.1 Implement FavoritesService (add/remove + tier→limit + cache invalidation)
    - Create `favorites.service.ts` implementing `FavoritesQuery`: `add` validates target (self/non-Cleaner → `422`, unknown user → `404`), resolves `getRoleTier(hostId, HOST)` (reusing Spec 11 bounded-timeout + FREE-degradation), maps `resolveLimit(tier)` (FREE→`FAVORITES_FREE_MAX`, PRO→`FAVORITES_PRO_MAX` with `null`=unlimited, no sentinel), calls `eligibility.assertMayAdd`, then `repo.addUnderLock`, invalidating cache only on `CREATED`; `remove` hard-deletes + invalidates (always `204`)
    - _Requirements: 1.2, 1.3, 1.5, 1.6, 2.1, 6.2 — Property 1, 5, 7 (REQ-FV2, REQ-FV5, REQ-FV11)_
  - [ ] 6.2 Implement the query surface (list / is-favorite / delivery ids / aggregate-count)
    - `listFavorites(hostId, page)` paginated `FavoriteView[]` with the display-only `unavailable` hint; `listFavoriteCleanerIds(hostId)` ids-only (ineligible included, `[]` when none, never throws); `isFavorite(hostId, cleanerId)`; `aggregateCountForCleaner(cleanerId)` returning only `{ count }` (never identities), gated by `FAVORITES_EXPOSE_AGGREGATE_COUNT`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6 — Property 3, 4, 6, 8, 9 (REQ-FV3, REQ-FV4, REQ-FV6, REQ-FV12)_
  - [ ]* 6.3 Unit tests for FavoritesService
    - `resolveLimit` mapping incl. `null`=unlimited; degraded tier read → FREE cap; add rejects self/non-Cleaner (`422`) + unknown (`404`); cache invalidated on `CREATED` only; remove always `204`; downgrade PRO→FREE deletes nothing; `listFavoriteCleanerIds` ids-only
    - _Requirements: 1.2, 1.3, 1.5, 1.6, 2.1, 3.3 — Property 1, 4, 5, 7_

- [ ] 7. Backend — Controller & module wiring
  - [ ] 7.1 Implement FavoritesController (Host CRUD + Cleaner aggregate-count)
    - Create `favorites.controller.ts` (`@Controller('favorites') @UseGuards(JwtAuthGuard)`) + `dto/add-favorite.dto.ts` (`cleanerId` validation) + `dto/list-favorites-query.dto.ts` (`limit` clamped to `[1, FAVORITES_LIST_MAX_LIMIT]`, `cursor`); identity resolved server-side (`keycloakId → userId`, never client-asserted)
    - Endpoints + status codes: `POST /favorites` → `201`/`204`/`422`/`404`; `DELETE /favorites/:cleanerId` → `204` (idempotent); `GET /favorites` → `200` paginated; `GET /favorites/is-favorite/:cleanerId` → `200 { isFavorite }`; `GET /favorites/aggregate-count` (Cleaner only) → `200 { count }` when flag on, `404` when off, `403` for non-Cleaner; non-Host on a Host endpoint → `403`, unauthenticated → `401`
    - _Requirements: 1.4, 2.3, 3.1, 3.2, 3.6, 6.3, 6.4 — Property 9, 10 (REQ-FV6, REQ-FV10)_
  - [ ] 7.2 Wire FavoritesModule and expose FavoritesQuery to Spec 7
    - Create `favorites.module.ts`: `TypeOrmModule.forFeature([Favorite])`; import `SubscriptionsModule` (for `SUBSCRIPTION_TIER`) + the Spec 20 qualifying-service contract + the users/roles + shared eligibility reader; providers: `FavoritesService`, `FavoritesRepository`, `FavoriteEligibilityPolicy`, `{ provide: FAVORITES_CACHE, useClass: NoopFavoritesCacheService }`, `{ provide: FAVORITES_QUERY, useExisting: FavoritesService }`; `exports: [FAVORITES_QUERY]`; `onModuleInit` runs `validateFavoritesConfig()`; register in `AppModule`; verify no cycle
    - _Requirements: 6.2, 6.5 — REQ-FV2, REQ-FV3_
  - [ ]* 7.3 Unit tests for controller + wiring
    - JWT identity → `hostId`/`cleanerId` (ignores client-supplied owner); Host-only guards (`403`); status codes `201`/`204`/`422`/`404`; aggregate-count flag gating (Cleaner-only, `404` disabled, no identities); DTO validation (`400`); Spec 7 resolves `listFavoriteCleanerIds` via the exported token
    - _Requirements: 1.4, 2.3, 3.6, 6.3, 6.4 — Property 9, 10_

- [ ] 8. Checkpoint — Backend favorites compiles and unit tests pass
  - Ensure config/validation, migration, types/entity, repository, cache seam, eligibility policy, service, controller, and module wiring compile and their unit tests pass; ask the user if questions arise.

- [ ] 9. Mobile — Store, API client, types & constants
  - [ ] 9.1 Create mobile favorites types & constants
    - Create `apps/mobile/src/screens/favorites/favorites.types.ts` (`FavoriteView` mirroring backend, `ConnectionState`, `AddResult`) and `favorites.constants.ts` (`ENDPOINTS`, i18n keys, BidClean dark tokens: `#00F5D4` accent, `#0B0C10` background, `#1F2833` cards)
    - _Requirements: 5.3_
  - [ ] 9.2 Implement favorites API client
    - Create `favorites.api.ts`: typed `add(cleanerId)`, `remove(cleanerId)`, `list(limit, cursor)`, `isFavorite(cleanerId)`, `aggregateCount()` via lazy `getApiClient()`
    - _Requirements: 5.1, 5.3_
  - [ ] 9.3 Implement useFavoritesStore (Zustand, optimistic toggle + reconcile)
    - Create `useFavoritesStore.ts`: paginated favorites list + `isFavorite` map keyed by `cleanerId`; `toggle(cleanerId)` applies an optimistic flip then reconciles via the API, reverting on failure (limit/network) with an i18n message; membership authority stays server-side (list/is-favorite reconcile the optimistic state)
    - _Requirements: 5.1, 5.5 — Property 3 (REQ-FV7)_
  - [ ]* 9.4 Unit tests for useFavoritesStore
    - Optimistic flip then reconcile; revert on failure with i18n message; `isFavorite` map stays consistent with the list; no local grant of authority
    - _Requirements: 5.1, 5.5_

- [ ] 10. Mobile — Components & screens
  - [ ] 10.1 Implement FavoriteToggle + FavoritesLimitBanner
    - Create `components/FavoriteToggle.tsx` (heart reflecting `is-favorite`, optimistic add/remove) and `components/FavoritesLimitBanner.tsx` (FREE-limit message driven by the `422` reason + optional PRO upsell); a `422` surfaces the banner and reverts the toggle
    - _Requirements: 5.1, 5.2_
  - [ ] 10.2 Implement FavoriteCard + FavoritesListScreen
    - Create `components/FavoriteCard.tsx` (cleaner display + remove + `unavailable` badge from the backend display-only hint, never auto-removed) and `FavoritesListScreen.tsx` (paginated view/remove in the Host area); en/es i18n parity; dark tokens
    - _Requirements: 3.5, 5.3_
  - [ ] 10.3 Reflect has-favorites in the publish "offer to favorites first" control
    - Wire the existing Spec 7 publish UX to disable/hint the "offer to favorites first" choice when the Host has no favorites, using the has-favorites signal from the store (favorites only supplies the signal; it does not own the publish control)
    - _Requirements: 5.4_
  - [ ]* 10.4 Unit tests for components + screens
    - Toggle reflects `is-favorite`; `422` surfaces the limit banner + reverts; list renders paginated with remove; ineligible Cleaner shows the `unavailable` badge; publish control disabled/hinted when empty; en/es parity; apiClient mocked (zero real external calls)
    - _Requirements: 3.5, 5.1, 5.2, 5.4_

- [ ] 11. Checkpoint — Full favorites UX integrated
  - Ensure mobile + backend integration works (toggle → add-under-limit → list/is-favorite reconcile; delivery reads `listFavoriteCleanerIds`); ask the user if questions arise.

- [ ] 12. Property-Based Tests (fast-check, ≥100 iterations each)
  - [ ]* 12.1 Property test: Idempotent add with limit boundary
    - **Property 1: Idempotent add with limit boundary**
    - **Validates: Requirements 1.1, 1.2 (REQ-FV2, REQ-FV5)**
    - Random add sequences with duplicates × limits (`null`/int>0) × prior counts, incl. re-add at exactly cap; assert one row per pair, `201` first / `204` duplicate / `422` iff new & `count >= limit`; duplicate-at-cap → `204` not `422`; no row on `422`
  - [ ]* 12.2 Property test: Limit holds strictly under concurrency
    - **Property 2: Limit holds strictly under concurrency**
    - **Validates: Requirements 7.4 (REQ-FV9)**
    - Random `N` concurrent adds (distinct cleaners) × cap `C`; final row count `== min(N, C)` (or `N` unlimited); never `> C`
  - [ ]* 12.3 Property test: Membership round-trip and authoritative query
    - **Property 3: Membership round-trip and authoritative query**
    - **Validates: Requirements 2.1, 2.4, 3.2, 4.5, 7.5 (REQ-FV5, REQ-FV7)**
    - Random interleaved add/remove/query; `isFavorite`/`listFavoriteCleanerIds` reflect committed rows at call time; remove idempotent; removed id never reappears (v1 no-op cache reads DB)
  - [ ]* 12.4 Property test: Delivery query returns exactly stored ids, ids only
    - **Property 4: Delivery query exactness**
    - **Validates: Requirements 3.3, 3.4, 4.2 (REQ-FV3, REQ-FV4, REQ-FV12)**
    - Random favorite sets incl. ineligible cleaners + empty sets; `listFavoriteCleanerIds` returns exactly stored `cleaner_id`s, ids only, ineligible included; `[]` for none, never throws
  - [ ]* 12.5 Property test: Non-destructive downgrade
    - **Property 5: Non-destructive downgrade**
    - **Validates: Requirements 1.6 (REQ-FV11)**
    - Random set size `S` under PRO then tier FREE with `C < S`; zero rows deleted; full set returned unchanged; new add `422` until count `< C`
  - [ ]* 12.6 Property test: Row set invariant to Cleaner eligibility
    - **Property 6: Row set is invariant to Cleaner eligibility**
    - **Validates: Requirements 3.5, 7.3 (REQ-FV12)**
    - Random favorites × arbitrary eligibility toggles; row set unchanged, no auto-delete, list/delivery never error; id always returned (marked `unavailable`), link reappears when eligible
  - [ ]* 12.7 Property test: Invalid target rejected with no row
    - **Property 7: Invalid target rejected with no row**
    - **Validates: Requirements 1.3, 1.5 (REQ-FV1)**
    - Targets partitioned {real cleaner, non-user, non-cleaner user, self}; only real distinct Cleaner addable; others `404`/`422`; no row created
  - [ ]* 12.8 Property test: Pagination determinism
    - **Property 8: Pagination determinism**
    - **Validates: Requirements 3.1 (REQ-FV1)**
    - Random favorite sets × page sizes; paging over cursors yields each favorite exactly once, deterministic `(created_at DESC, id DESC)`; union == full set
  - [ ]* 12.9 Property test: Aggregate-count correctness & no host-identity exposure
    - **Property 9: Aggregate-count correctness and no host-identity exposure**
    - **Validates: Requirements 3.6 (REQ-FV6)**
    - Random host→cleaner graphs × flag on/off; count == distinct hosts favoriting the cleaner; response has no host identifiers; flag-off → unavailable (`404`)
  - [ ]* 12.10 Property test: Response privacy and shape
    - **Property 10: Response privacy and shape**
    - **Validates: Requirements 6.3, 6.4 (REQ-FV6, REQ-FV10)**
    - Random responses (list, is-favorite, aggregate-count); only the caller's own data + whitelisted safe fields; no host identities in aggregate-count; authorization from the JWT subject
  - [ ]* 12.11 Property test: Configuration integrity and fail-fast validation
    - **Property 11: Configuration integrity and fail-fast validation**
    - **Validates: Requirements 6.1, 6.2 (REQ-FV2, REQ-FV10)**
    - Random config maps (missing/invalid/valid; negative/zero FREE cap; malformed PRO cap/flags); validator throws iff required missing/invalid, passes otherwise; no literal caps in logic
  - [ ]* 12.12 Property test: Add-eligibility policy enforced & config-driven
    - **Property 12: Add-eligibility policy is enforced and config-driven**
    - **Validates: Requirements 4.3, 6.1 (REQ-FV3, REQ-FV10)**
    - Random `(host, cleaner)` × flag on/off × stubbed `hasQualifyingService` true/false; flag `true` → never blocks; flag `false` → allowed iff a qualifying service exists else `422` + no row; deterministic in `(flag, hasQualifyingService)`; owns no completion logic

- [ ] 13. DDL / Migration & Integration Tests
  - [ ]* 13.1 DDL / migration tests
    - Assert constraints/indexes present (`uq_favorites_host_cleaner`, `chk_favorites_not_self`, `idx_favorites_host`, `idx_favorites_cleaner`, `idx_favorites_host_created`, both FKs `ON DELETE CASCADE`, NO `updated_at`/`deleted_at`, table/column comments); migration reversible (`up()` + `down()`), `IF NOT EXISTS`
    - _Requirements: 7.1, 7.2 — REQ-FV1, REQ-FV8_
  - [ ]* 13.2 Integration: add / duplicate / over-limit
    - Add → `201` one row; duplicate add → `204` still one row; new add at cap → `422`; duplicate add at cap → `204` (existence before limit)
    - _Requirements: 1.1, 1.2 — Property 1_
  - [ ]* 13.3 Integration: concurrency cap under real advisory lock
    - Concurrent adds for one Host near the cap (real transactions + `pg_advisory_xact_lock`) → final count never exceeds the cap
    - _Requirements: 7.4 — Property 2_
  - [ ]* 13.4 Integration: remove idempotency & ownership scoping
    - Remove → `204` row gone; double-remove / remove-never-added → `204` no error; another Host cannot remove the owner's row
    - _Requirements: 2.1, 2.3 — Property 3_
  - [ ]* 13.5 Integration: CASCADE on user deletion
    - Delete the user as host, then as cleaner → referencing `favorites` rows cascade away
    - _Requirements: 7.2 — REQ-FV8_
  - [ ]* 13.6 Integration: delivery query + downgrade + aggregate-count
    - `listFavoriteCleanerIds` returns exactly stored ids incl. an ineligible Cleaner, `[]` for none; downgrade PRO→FREE over cap retains the set + delivery ids unchanged + new add `422`; aggregate-count flag on → correct distinct-host count with no identities, flag off → `404`; non-Host on a Host endpoint → `403`, unauthenticated → `401`
    - _Requirements: 1.6, 3.3, 3.6, 4.2 — Property 4, 5, 9_

- [ ] 14. Documentation
  - [ ] 14.1 Write module READMEs
    - Create `services/api/src/favorites/README.md` (purpose, endpoints + status codes, the add-under-lock limit flow, the delivery-facing `FavoritesQuery`, env vars) and `apps/mobile/src/screens/favorites/README.md` (toggle + list UX, optimistic reconcile, i18n, dark tokens)
    - _Requirements: 6.5_
  - [ ] 14.2 Update ARCHITECTURE, CHANGELOG, ROADMAP, .env.example
    - `docs/ARCHITECTURE.md`: add the favorites module to the backend module diagram + a favorites-feeds-delivery edge (favorites → Spec 7 `listFavoriteCleanerIds`; favorites → Spec 11 `getRoleTier`); `docs/CHANGELOG.md`: `[Unreleased]` entry for feature `favorites`; `.kiro/specs/ROADMAP.md`: mark Spec 22 status; confirm `.env.example` `FAVORITES_*` entries (from Task 1.1)
    - Add an ADR in `docs/ADR/` ONLY if the host-scoped advisory-lock cap approach (or the CASCADE-from-users / feeds-not-replaces boundary) is deemed a notable decision worth recording; otherwise none
    - _Requirements: 6.5_

- [ ] 15. Final Checkpoint — All tests pass
  - Ensure all backend + mobile tests pass and the CI-equivalent commands are green locally (services/api tsc + eslint --max-warnings 0 + jest; mobile tsc --noEmit + ESLint + Jest); ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements (by acceptance-criteria number) and the correctness properties / REQ-FV invariants it implements
- Checkpoints ensure incremental validation
- Property tests validate the 12 universal correctness properties (P1–P12) from the design document; each runs ≥100 fast-check iterations
- **Boundary (strict):** favorites owns ONE table and answers `isFavorite` / `listFavoriteCleanerIds` (ids-only). It FEEDS Spec 7 and does NOT reimplement the favorites-first window, tiering, expansion, Cleaner-eligibility filtering, or read↔deliver atomicity
- Coupling is one-directional and cycle-free: favorites imports only the Spec 11 `SUBSCRIPTION_TIER` token/interface, the Spec 20 `hasQualifyingService` predicate, the users/roles read, and the shared user/role/KYC eligibility reader; Spec 7 depends on the exported `FavoritesQuery` token
- **Add-under-limit correctness:** advisory lock → existence check FIRST (`204` even at cap) → count (only when capped) → `OVER_LIMIT` (`422`) for a new pair at/over cap → `INSERT ... ON CONFLICT DO NOTHING` (`201`). `ALREADY_EXISTS` strictly precedes `OVER_LIMIT`
- **Downgrade is non-destructive:** PRO→FREE never deletes a favorite; the over-cap set is retained and keeps delivering; only new adds are blocked until under the FREE cap
- **CASCADE from users is correct here:** a favorite is a live relationship, not shared history (the deliberate contrast with chat/calls/completions SET NULL)
- **Cache is a no-op in v1** (reads PostgreSQL directly = authoritative membership at query time); a future cache MUST use durable invalidation, a versioned entry with DB fallback, or be non-authoritative — never a bare post-commit `invalidate`
- Tier resolution reuses Spec 11's bounded-timeout + FREE-degradation; a degraded read applies the safe FREE cap
- No hardcoded caps/flags: all `FAVORITES_*` come from config, validated fail-fast at startup (skipped under `NODE_ENV=test`)
- Authorization is resolved server-side from the JWT subject (`keycloakId → userId`), never client-asserted; all queries parameterized
- Migration `1700000019000-CreateFavorites.ts` follows the subscriptions migration `1700000018000`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "3.1", "3.2"] },
    { "id": 2, "tasks": ["4.1", "4.2", "5.1", "5.2"] },
    { "id": 3, "tasks": ["4.3", "5.3", "6.1", "6.2"] },
    { "id": 4, "tasks": ["6.3", "7.1", "7.2"] },
    { "id": 5, "tasks": ["7.3", "9.1", "9.2"] },
    { "id": 6, "tasks": ["9.3", "10.1", "10.3"] },
    { "id": 7, "tasks": ["9.4", "10.2"] },
    { "id": 8, "tasks": ["10.4"] },
    { "id": 9, "tasks": ["12.1", "12.2", "12.3", "12.4", "12.5", "12.6", "12.7", "12.8", "12.9", "12.10", "12.11", "12.12"] },
    { "id": 10, "tasks": ["13.1", "13.2", "13.3", "13.4", "13.5", "13.6"] },
    { "id": 11, "tasks": ["14.1", "14.2"] }
  ]
}
```
