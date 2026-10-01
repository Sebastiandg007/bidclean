import { Injectable } from '@nestjs/common';

/**
 * FavoritesCacheService — the derived-cache seam (Spec 22).
 *
 * v1 ships the NO-OP pass-through binding below, so favorites always reads PostgreSQL — the
 * authoritative membership at query time (a query reflects the committed rows at the moment it runs).
 * The `host_id`-indexed read is cheap, so a cache buys little in v1 and would only add a staleness
 * risk.
 *
 * A future Redis-backed cache MUST NOT rely on this `invalidate(hostId)` alone for freshness: a bare
 * post-commit invalidation can FAIL after the write is durable, leaving a stale membership that
 * delivery would then read. A real cache MUST additionally adopt one of:
 *   (a) durable invalidation — the invalidation is persisted (outbox/event) in the same tx and
 *       applied by a retried consumer, so a crashed/failed invalidation is re-driven, not lost;
 *   (b) a versioned cache — each entry carries a membership version and a reader that observes a
 *       version miss/mismatch falls back to the DB, so a stale entry is never silently trusted;
 *   (c) cache-is-not-authority — the cache is a pure read accelerator and Spec 7 always validates
 *       the authoritative membership (DB or version) before acting.
 * Absent one of these, the cache MUST stay the v1 no-op.
 */
export interface FavoritesCacheService {
  /** Return the cached Cleaner ids for the Host, or `null` on a miss (default impl always misses). */
  getCleanerIds(hostId: string): Promise<string[] | null>;
  /** Populate the cache for the Host (no-op in v1). */
  set(hostId: string, cleanerIds: string[]): Promise<void>;
  /** Invalidate the Host's cached membership; called on every add/remove (best-effort no-op in v1). */
  invalidate(hostId: string): Promise<void>;
}

/**
 * The v1 no-op pass-through: `getCleanerIds` always misses (forcing the authoritative DB read),
 * `set`/`invalidate` do nothing. Introducing a cache is a binding swap, not a service rewrite.
 */
@Injectable()
export class NoopFavoritesCacheService implements FavoritesCacheService {
  async getCleanerIds(_hostId: string): Promise<string[] | null> {
    return null;
  }

  async set(_hostId: string, _cleanerIds: string[]): Promise<void> {
    // no-op — v1 reads PostgreSQL directly (authoritative membership at query time).
  }

  async invalidate(_hostId: string): Promise<void> {
    // no-op — nothing is cached in v1.
  }
}
