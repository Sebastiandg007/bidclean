/**
 * favorites domain types + internal contracts (Spec 22).
 *
 * favorites owns ONE row (the directed Host->Cleaner favorite) and answers exactly two
 * delivery-facing questions (`listFavoriteCleanerIds`, `isFavorite`). It returns ids only for
 * delivery; Spec 7 owns eligibility filtering, the favorites-first window, tiering, expansion, and
 * read<->deliver atomicity. No PII beyond safe display fields is modeled here.
 */

/**
 * The tier-based favorite count limit. `null` = UNLIMITED, an `integer > 0` = capped. There is NO
 * magic sentinel (never -1): "unlimited" is represented structurally by `null`.
 */
export type FavoriteLimit = number | null;

/** The outcome of an add attempt (maps to the controller HTTP status). */
export const AddResult = {
  /** A new row was inserted (201). */
  CREATED: 'CREATED',
  /** The pair already existed — idempotent, no second row (204). Precedes OVER_LIMIT. */
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  /** A genuinely new pair was rejected because the Host is at their cap (422). */
  OVER_LIMIT: 'OVER_LIMIT',
} as const;
export type AddResult = (typeof AddResult)[keyof typeof AddResult];

/**
 * A single favorite as shown in the Host list. `unavailable` is a DISPLAY-ONLY hint sourced from a
 * shared user/role/KYC eligibility reader (consumed, not owned); favorites owns no eligibility logic,
 * the row is never deleted for it, and it NEVER affects `listFavoriteCleanerIds` (which returns all
 * ids, ids-only).
 */
export interface FavoriteView {
  readonly cleanerId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly favoritedAt: string;
  readonly unavailable: boolean;
}

/** A validated cursor page request for the Host list. */
export interface CursorPage {
  /** Clamped to [1, FAVORITES_LIST_MAX_LIMIT] by the service. */
  readonly limit: number;
  /** Opaque keyset cursor encoding (created_at, id), or null for the first page. */
  readonly cursor: string | null;
}

/** A generic keyset-paginated result. */
export interface Paginated<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/**
 * The delivery-facing query surface consumed by offer-radar (Spec 7). Returns ONLY Cleaner ids for
 * the Host's favorites — no eligibility filtering (Spec 7 owns that), and no read<->deliver
 * atomicity guarantee beyond "reflects committed rows at call time".
 */
export interface FavoritesQuery {
  /** All favorited Cleaner ids for the Host (ineligible included, `[]` when none, never throws). */
  listFavoriteCleanerIds(hostId: string): Promise<string[]>;
  /** Whether the (host, cleaner) pair currently exists. */
  isFavorite(hostId: string, cleanerId: string): Promise<boolean>;
}

/**
 * The Spec 20 qualifying-service predicate the add-eligibility policy consults when
 * `FAVORITES_ALLOW_ADD_WITHOUT_SERVICE === false`. favorites CONSULTS this — it never owns or
 * re-derives completion logic. The default binding (a seam) always resolves `false`; the real
 * service-completion implementation is wired by the orchestrator (see WIRING).
 */
export interface QualifyingServiceQuery {
  /** Whether a prior qualifying/completed service exists between the Host and the Cleaner. */
  hasQualifyingService(hostId: string, cleanerId: string): Promise<boolean>;
}
