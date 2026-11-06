/**
 * favorites configuration, endpoint-facing constants, and error strings (Spec 22).
 *
 * Every tunable comes from the environment with a documented default — no favorite limit, exposure
 * flag, add-without-service policy, or cache TTL is a hardcoded literal in logic. Fail-fast
 * validation lives in `config/validate-favorites-config.ts` and runs at startup (skipped under
 * NODE_ENV=test). No security-sensitive secret is introduced by this spec: the Host tier is read
 * through the Spec 11 `SUBSCRIPTION_TIER` contract, never a subscription store here.
 *
 * The count limit is represented WITHOUT magic sentinels: `null` = UNLIMITED, an `integer > 0` =
 * capped. `FAVORITES_FREE_MAX` is a positive integer; `FAVORITES_PRO_MAX` is unset/empty (unlimited)
 * or a positive integer.
 */

/**
 * Parse an env integer with a default; an unset OR empty value uses the fallback (so an empty env
 * var behaves as unset, consistent with `envLimit`). Kept private so callers read the constants only.
 */
function envInt(name: string, fallback: string): number {
  const raw = process.env[name];
  return parseInt(raw === undefined || raw.trim().length === 0 ? fallback : raw, 10);
}

/**
 * Parse an env limit that may be UNLIMITED. Unset/empty resolves to `null` (unlimited); any other
 * value is parsed as an integer (validated separately). Never returns a magic sentinel like -1.
 */
function envLimit(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim().length === 0) {
    return null;
  }
  return parseInt(raw, 10);
}

/** Parse an env boolean with a default; only the literal 'true'/'false' (case-insensitive) parse. */
function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  return raw.trim().toLowerCase() === 'true';
}

// ─── Tier-based count limit (null = unlimited, integer > 0 = capped) ──────────────

/** Max favorites for a FREE Host (positive integer; no magic sentinel). Required. */
export const FAVORITES_FREE_MAX = envInt('FAVORITES_FREE_MAX', '20');

/** Max favorites for a PRO Host: unset/empty = unlimited (`null`), or a positive integer cap. */
export const FAVORITES_PRO_MAX: number | null = envLimit('FAVORITES_PRO_MAX');

// ─── Feature flags ───────────────────────────────────────────────────────────────

/** Whether the Cleaner-facing aggregate-count endpoint is enabled (never leaks host identities). */
export const FAVORITES_EXPOSE_AGGREGATE_COUNT = envBool('FAVORITES_EXPOSE_AGGREGATE_COUNT', false);

/**
 * Whether a Host may favorite without a prior completed service. When `false`, the add-eligibility
 * policy consults the Spec 20 qualifying-service predicate. Default `true` (no service required).
 */
export const FAVORITES_ALLOW_ADD_WITHOUT_SERVICE = envBool(
  'FAVORITES_ALLOW_ADD_WITHOUT_SERVICE',
  true,
);

// ─── Pagination / cache ──────────────────────────────────────────────────────────

/** Max page size for `GET /favorites` (positive integer). */
export const FAVORITES_LIST_MAX_LIMIT = envInt('FAVORITES_LIST_MAX_LIMIT', '50');

/** Default page size for `GET /favorites` when the caller sends none. */
export const FAVORITES_LIST_DEFAULT_LIMIT = envInt('FAVORITES_LIST_DEFAULT_LIMIT', '20');

/**
 * Derived-cache TTL (ms) if a cache is bound; `null` when unset (unused by the default no-op cache).
 * Validated as a positive integer only when present.
 */
export const FAVORITES_CACHE_TTL_MS: number | null = envLimit('FAVORITES_CACHE_TTL_MS');

// ─── DI tokens ─────────────────────────────────────────────────────────────────

/** DI token binding the delivery-facing `FavoritesQuery` (consumed by offer-radar / Spec 7). */
export const FAVORITES_QUERY = Symbol('FAVORITES_QUERY');

/** DI token binding the derived `FavoritesCacheService` (no-op pass-through in v1). */
export const FAVORITES_CACHE = Symbol('FAVORITES_CACHE');

/**
 * DI token binding the Spec 20 qualifying-service predicate the add-eligibility policy consults when
 * `FAVORITES_ALLOW_ADD_WITHOUT_SERVICE === false`. favorites owns a default allow-all binding (a
 * seam); the real service-completion (Spec 20) predicate is wired by the orchestrator (see WIRING).
 */
export const QUALIFYING_SERVICE_QUERY = Symbol('QUALIFYING_SERVICE_QUERY');

// ─── Error strings (non-sensitive; structural / authorization / limit) ────────────

/** favorites error messages (no PII / secrets). */
export const FAVORITES_ERROR_MESSAGES = {
  /** The authenticated Keycloak subject does not resolve to a BidClean user. */
  USER_NOT_FOUND: 'User not found',
  /** The target cleanerId is not a real user. */
  CLEANER_NOT_FOUND: 'Cleaner not found',
  /** The target is not a Cleaner-role user. */
  NOT_A_CLEANER: 'The target user is not a cleaner',
  /** The Host tried to favorite themselves. */
  CANNOT_FAVORITE_SELF: 'A host cannot favorite themselves',
  /** The Host is at their tier favorite limit. */
  OVER_LIMIT: 'You have reached your favorites limit',
  /** A prior qualifying service is required to add this favorite. */
  QUALIFYING_SERVICE_REQUIRED: 'A completed service with this cleaner is required to favorite them',
  /** The aggregate-count endpoint is disabled by configuration. */
  AGGREGATE_COUNT_DISABLED: 'Aggregate count is not available',
  /** A Host endpoint was called by a caller without the Host role. */
  NOT_A_HOST: 'The host role is required for this action',
  /** A Cleaner-facing endpoint was called by a caller without the Cleaner role. */
  NOT_A_CLEANER_CALLER: 'The cleaner role is required for this action',
} as const;
