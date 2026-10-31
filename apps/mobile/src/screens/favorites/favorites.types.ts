/**
 * favorites.types — Mobile domain types for favorites (Spec 22).
 *
 * Mirrors the backend `favorites` contracts (the Host list view + the add result). Membership
 * authority stays server-side: the client is convenience only, and `is-favorite`/list reconcile the
 * optimistic toggle state. No host identities are ever modeled (the Cleaner never sees who favorited
 * them beyond an aggregate count).
 */

/** The add outcome mirrored from the backend (drives optimistic reconcile + the limit banner). */
export type AddResult = 'CREATED' | 'ALREADY_EXISTS' | 'OVER_LIMIT';

/** Best-effort connection status surfaced to the UI (parity with sibling stores). */
export type ConnectionState = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';

/**
 * A single favorite as shown in the Host list. `unavailable` is a display-only hint from the
 * backend (shared user/role/KYC eligibility reader); the row is never auto-removed for it.
 */
export interface FavoriteView {
  readonly cleanerId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly favoritedAt: string;
  readonly unavailable: boolean;
}

/** A keyset-paginated list page (matches the backend `Paginated<FavoriteView>`). */
export interface FavoritesPage {
  readonly items: readonly FavoriteView[];
  readonly nextCursor: string | null;
}
