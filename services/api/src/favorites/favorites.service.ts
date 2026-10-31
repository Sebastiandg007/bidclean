import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { SubscriberRole, SubscriberTier } from '../commission/commission.types';
import {
  SUBSCRIPTION_TIER,
  SubscriptionTierContract,
} from '../commission/contracts/subscription-tier.interface';
import { FavoriteEligibilityPolicy } from './favorite-eligibility.policy';
import {
  FAVORITES_CACHE,
  FAVORITES_ERROR_MESSAGES,
  FAVORITES_FREE_MAX,
  FAVORITES_LIST_MAX_LIMIT,
  FAVORITES_PRO_MAX,
} from './favorites.constants';
import { FavoritesCacheService } from './favorites.cache';
import { DecodedCursor, FavoriteListRow, FavoritesRepository } from './favorites.repository';
import {
  AddResult,
  CursorPage,
  FavoriteLimit,
  FavoriteView,
  FavoritesQuery,
  Paginated,
} from './favorites.types';

/**
 * FavoritesService — add/remove + tier→limit resolution + the delivery-facing query surface
 * (Spec 22). Implements `FavoritesQuery` (consumed by Spec 7 via the exported token).
 *
 * `add` validates the target (self/non-Cleaner → 422, unknown user → 404), resolves the Host tier
 * through the Spec 11 `SUBSCRIPTION_TIER` contract (reusing its bounded-timeout + FREE-degradation),
 * maps it to a limit (no sentinel), enforces the add-eligibility policy, then adds under the
 * host-scoped lock, invalidating the cache only on `CREATED`. `remove` is an idempotent hard delete
 * that always invalidates and returns void. All functions are small and single-responsibility.
 */
@Injectable()
export class FavoritesService implements FavoritesQuery {
  constructor(
    private readonly repo: FavoritesRepository,
    @Inject(SUBSCRIPTION_TIER) private readonly tier: SubscriptionTierContract,
    private readonly eligibility: FavoriteEligibilityPolicy,
    @Inject(FAVORITES_CACHE) private readonly cache: FavoritesCacheService,
  ) {}

  /** POST /favorites — 201 CREATED | 204 ALREADY_EXISTS | 422 OVER_LIMIT (throws 404/422 on invalid). */
  async add(hostId: string, cleanerId: string): Promise<AddResult> {
    await this.assertValidTarget(hostId, cleanerId);
    await this.eligibility.assertMayAdd(hostId, cleanerId);

    const limit = await this.resolveLimit(hostId);
    const result = await this.repo.addUnderLock(hostId, cleanerId, limit);

    if (result === AddResult.OVER_LIMIT) {
      throw new UnprocessableEntityException(FAVORITES_ERROR_MESSAGES.OVER_LIMIT);
    }
    if (result === AddResult.CREATED) {
      await this.cache.invalidate(hostId);
    }
    return result;
  }

  /** DELETE /favorites/:cleanerId — idempotent hard delete; always resolves (204 at the controller). */
  async remove(hostId: string, cleanerId: string): Promise<void> {
    await this.repo.deleteFavorite(hostId, cleanerId);
    await this.cache.invalidate(hostId);
  }

  /** GET /favorites — one keyset page of the Host's favorites (safe display fields + unavailable hint). */
  async listFavorites(hostId: string, page: CursorPage): Promise<Paginated<FavoriteView>> {
    const limit = this.clampLimit(page.limit);
    const cursor = this.decodeCursor(page.cursor);
    const rows = await this.repo.listByHost(hostId, limit, cursor);
    return this.toPage(rows, limit);
  }

  /** Delivery query: all favorited Cleaner ids for the Host (ids only, ineligible included). */
  async listFavoriteCleanerIds(hostId: string): Promise<string[]> {
    return this.repo.listCleanerIds(hostId);
  }

  /** Toggle-state query: whether the pair currently exists. */
  async isFavorite(hostId: string, cleanerId: string): Promise<boolean> {
    return this.repo.existsFavorite(hostId, cleanerId);
  }

  /** Cleaner-facing aggregate count (opt-in at the controller); returns a number only, no identities. */
  async aggregateCountForCleaner(cleanerId: string): Promise<number> {
    return this.repo.countByCleaner(cleanerId);
  }

  /** Resolve the Host's limit: FREE → FAVORITES_FREE_MAX, PRO → FAVORITES_PRO_MAX (null = unlimited). */
  private async resolveLimit(hostId: string): Promise<FavoriteLimit> {
    const tier = await this.tier.getRoleTier(hostId, SubscriberRole.HOST);
    return tier === SubscriberTier.PRO ? FAVORITES_PRO_MAX : FAVORITES_FREE_MAX;
  }

  /** Reject self-favorite (422), unknown user (404), and non-Cleaner target (422) before adding. */
  private async assertValidTarget(hostId: string, cleanerId: string): Promise<void> {
    if (hostId === cleanerId) {
      throw new UnprocessableEntityException(FAVORITES_ERROR_MESSAGES.CANNOT_FAVORITE_SELF);
    }
    const exists = await this.repo.userExists(cleanerId);
    if (!exists) {
      throw new NotFoundException(FAVORITES_ERROR_MESSAGES.CLEANER_NOT_FOUND);
    }
    const isCleaner = await this.repo.isCleaner(cleanerId);
    if (!isCleaner) {
      throw new UnprocessableEntityException(FAVORITES_ERROR_MESSAGES.NOT_A_CLEANER);
    }
  }

  /** Clamp a requested page size to [1, FAVORITES_LIST_MAX_LIMIT]. */
  private clampLimit(requested: number): number {
    if (!Number.isInteger(requested) || requested < 1) {
      return 1;
    }
    return Math.min(requested, FAVORITES_LIST_MAX_LIMIT);
  }

  /** Build the paginated view: trim the sentinel `limit + 1` row and emit the next cursor. */
  private toPage(rows: readonly FavoriteListRow[], limit: number): Paginated<FavoriteView> {
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const items = pageRows.map((row) => FavoritesRepository.toView(row));
    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && last !== undefined ? this.encodeCursor(last) : null;
    return { items, nextCursor };
  }

  /** Encode a keyset cursor from the last row's (created_at, favorite_id). */
  private encodeCursor(row: FavoriteListRow): string {
    const payload = JSON.stringify({ c: row.created_at.toISOString(), i: row.favorite_id });
    return Buffer.from(payload, 'utf8').toString('base64url');
  }

  /** Decode an opaque keyset cursor; a malformed cursor is treated as the first page (no throw). */
  private decodeCursor(cursor: string | null): DecodedCursor | null {
    if (cursor === null || cursor.length === 0) {
      return null;
    }
    try {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
        c?: unknown;
        i?: unknown;
      };
      if (typeof decoded.c === 'string' && typeof decoded.i === 'string') {
        return { createdAt: decoded.c, id: decoded.i };
      }
      return null;
    } catch {
      return null;
    }
  }
}
