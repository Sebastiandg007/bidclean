import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AddResult, FavoriteLimit, FavoriteView } from './favorites.types';

/** The Cleaner role value as stored in `users.roles` (matches UserRole.CLEANER). */
const CLEANER_ROLE = 'cleaner';

/** A raw favorite-list row as projected by the keyset query (snake_case as stored/joined). */
export interface FavoriteListRow {
  readonly cleaner_id: string;
  readonly favorite_id: string;
  readonly display_name: string | null;
  readonly full_name: string | null;
  readonly photo_storage_key: string | null;
  readonly created_at: Date;
  readonly unavailable: boolean;
}

/** A decoded keyset cursor (created_at, id) for deterministic pagination. */
export interface DecodedCursor {
  readonly createdAt: string;
  readonly id: string;
}

/**
 * FavoritesRepository — parameterized SQL only for the `favorites` table (Spec 22).
 *
 * The correctness core is `addUnderLock`: within ONE transaction it acquires a host-scoped advisory
 * lock, checks EXISTENCE FIRST (a duplicate returns ALREADY_EXISTS before any limit check — so a
 * re-add at cap is 204, never 422), then (only when capped) counts and aborts OVER_LIMIT when
 * `count >= limit`, otherwise inserts with `ON CONFLICT DO NOTHING` as a belt-and-suspenders guard.
 * This ordering makes duplicate-before-limit hold and keeps the cap a hard guarantee under
 * concurrency (a per-`host_id` advisory lock serializes concurrent adds for one Host).
 */
@Injectable()
export class FavoritesRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Add a favorite under a host-scoped advisory lock. Ordering (all in one tx):
   *   1. `pg_advisory_xact_lock(hashtextextended(host_id, 0))` — serialize this Host's adds.
   *   2. existence check FIRST — a duplicate returns ALREADY_EXISTS before any limit check.
   *   3. if `limit !== null`, count and abort OVER_LIMIT when `count >= limit` (new pair only).
   *   4. `INSERT ... ON CONFLICT (host_id, cleaner_id) DO NOTHING RETURNING id` (guard).
   * PRO/unlimited (`limit === null`) skips the count entirely.
   */
  async addUnderLock(hostId: string, cleanerId: string, limit: FavoriteLimit): Promise<AddResult> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [hostId]);

      const existsRows = await manager.query<Array<{ exists: boolean }>>(
        `SELECT EXISTS(
           SELECT 1 FROM "favorites" WHERE "host_id" = $1 AND "cleaner_id" = $2
         ) AS "exists"`,
        [hostId, cleanerId],
      );
      if (existsRows[0]?.exists === true) {
        return AddResult.ALREADY_EXISTS;
      }

      if (limit !== null) {
        const countRows = await manager.query<Array<{ count: string }>>(
          `SELECT count(*)::text AS "count" FROM "favorites" WHERE "host_id" = $1`,
          [hostId],
        );
        const current = parseInt(countRows[0]?.count ?? '0', 10);
        if (current >= limit) {
          return AddResult.OVER_LIMIT;
        }
      }

      const inserted = await manager.query<Array<{ id: string }>>(
        `INSERT INTO "favorites" ("host_id", "cleaner_id")
         VALUES ($1, $2)
         ON CONFLICT ("host_id", "cleaner_id") DO NOTHING
         RETURNING "id"`,
        [hostId, cleanerId],
      );
      // A concurrent insert of the same pair (past the lock, in theory) hits ON CONFLICT → no row.
      return inserted[0] !== undefined ? AddResult.CREATED : AddResult.ALREADY_EXISTS;
    });
  }

  /** Idempotent hard delete of the (host, cleaner) row; 0 rows deleted is fine. */
  async deleteFavorite(hostId: string, cleanerId: string): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM "favorites" WHERE "host_id" = $1 AND "cleaner_id" = $2`,
      [hostId, cleanerId],
    );
  }

  /** Whether the (host, cleaner) pair currently exists. */
  async existsFavorite(hostId: string, cleanerId: string): Promise<boolean> {
    const rows = await this.dataSource.query<Array<{ exists: boolean }>>(
      `SELECT EXISTS(
         SELECT 1 FROM "favorites" WHERE "host_id" = $1 AND "cleaner_id" = $2
       ) AS "exists"`,
      [hostId, cleanerId],
    );
    return rows[0]?.exists === true;
  }

  /**
   * Delivery query: all favorited Cleaner ids for the Host (ids only, ineligible included, never
   * filtered). Uses `idx_favorites_host`. Ordered deterministically for stable output.
   */
  async listCleanerIds(hostId: string): Promise<string[]> {
    const rows = await this.dataSource.query<Array<{ cleaner_id: string }>>(
      `SELECT "cleaner_id" FROM "favorites"
       WHERE "host_id" = $1
       ORDER BY "created_at" DESC, "id" DESC`,
      [hostId],
    );
    return rows.map((row) => row.cleaner_id);
  }

  /** Count of distinct Hosts who favorited the given Cleaner (aggregate-count; uses cleaner index). */
  async countByCleaner(cleanerId: string): Promise<number> {
    const rows = await this.dataSource.query<Array<{ count: string }>>(
      `SELECT count(*)::text AS "count" FROM "favorites" WHERE "cleaner_id" = $1`,
      [cleanerId],
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  }

  /**
   * The Host list, one page: keyset pagination on `(created_at DESC, id DESC)` joining minimal safe
   * Cleaner display fields. The `unavailable` hint is a display-only status read (deactivated user
   * or no longer a Cleaner) — it never filters or removes rows. Fetches `limit + 1` to derive the
   * next cursor without a second query.
   */
  async listByHost(
    hostId: string,
    limit: number,
    cursor: DecodedCursor | null,
  ): Promise<readonly FavoriteListRow[]> {
    // $1 host, $2 cleaner-role, then keyset ($3,$4) when present, then the row limit ($n).
    const params: unknown[] = [hostId, CLEANER_ROLE];
    let keysetClause = '';
    if (cursor !== null) {
      keysetClause = `AND ("f"."created_at", "f"."id") < ($3::timestamptz, $4::uuid)`;
      params.push(cursor.createdAt, cursor.id);
    }
    params.push(limit + 1);
    const limitParam = `$${params.length}`;

    return this.dataSource.query<FavoriteListRow[]>(
      `SELECT
         "f"."cleaner_id" AS "cleaner_id",
         "f"."id" AS "favorite_id",
         "f"."created_at" AS "created_at",
         COALESCE("cp"."display_name", "pd"."display_name") AS "display_name",
         "u"."full_name" AS "full_name",
         "pd"."photo_storage_key" AS "photo_storage_key",
         (
           "u"."id" IS NULL
           OR "u"."deletion_status" IS NOT NULL
           OR NOT ($2 = ANY("u"."roles"))
         ) AS "unavailable"
       FROM "favorites" "f"
       LEFT JOIN "users" "u" ON "u"."id" = "f"."cleaner_id"
       LEFT JOIN "cleaner_profiles" "cp" ON "cp"."user_id" = "f"."cleaner_id"
       LEFT JOIN "profile_details" "pd" ON "pd"."user_id" = "f"."cleaner_id"
       WHERE "f"."host_id" = $1 ${keysetClause}
       ORDER BY "f"."created_at" DESC, "f"."id" DESC
       LIMIT ${limitParam}`,
      params,
    );
  }

  /** Whether the target is a real, non-deleted user WITH the Cleaner role (add guard). */
  async isCleaner(userId: string): Promise<boolean> {
    const rows = await this.dataSource.query<Array<{ is_cleaner: boolean }>>(
      `SELECT (
         "deletion_status" IS NULL AND $2 = ANY("roles")
       ) AS "is_cleaner"
       FROM "users" WHERE "id" = $1 LIMIT 1`,
      [userId, CLEANER_ROLE],
    );
    return rows[0]?.is_cleaner === true;
  }

  /** Whether the target is a real user at all (distinguishes 404 non-user from 422 non-Cleaner). */
  async userExists(userId: string): Promise<boolean> {
    const rows = await this.dataSource.query<Array<{ exists: boolean }>>(
      `SELECT EXISTS(SELECT 1 FROM "users" WHERE "id" = $1) AS "exists"`,
      [userId],
    );
    return rows[0]?.exists === true;
  }

  /** Map a raw list row to the safe `FavoriteView` (display-only `unavailable` hint retained). */
  static toView(row: FavoriteListRow): FavoriteView {
    return {
      cleanerId: row.cleaner_id,
      displayName: row.display_name ?? row.full_name ?? '',
      avatarUrl: row.photo_storage_key,
      favoritedAt: row.created_at.toISOString(),
      unavailable: row.unavailable === true,
    };
  }
}
