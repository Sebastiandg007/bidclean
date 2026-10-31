import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';

import { SubscriberRole, SubscriberTier } from '../../commission/commission.types';
import { SubscriptionTierContract } from '../../commission/contracts/subscription-tier.interface';
import { FavoriteEligibilityPolicy } from '../favorite-eligibility.policy';
import { NoopFavoritesCacheService } from '../favorites.cache';
import { FavoritesRepository } from '../favorites.repository';
import { FavoritesService } from '../favorites.service';
import { AddResult } from '../favorites.types';

/**
 * Unit tests for FavoritesService (Spec 22).
 *
 * The repository, tier contract, eligibility policy, and cache are faked (no DB/network). Covers the
 * add validation + tier→limit resolution + cache-invalidate-on-CREATED-only, idempotent remove,
 * the delivery ids-only query, and Property 10 (response privacy/shape: only whitelisted safe fields,
 * no host identities in the aggregate count).
 */

interface FakeRepo {
  userExists: jest.Mock;
  isCleaner: jest.Mock;
  addUnderLock: jest.Mock;
  deleteFavorite: jest.Mock;
  existsFavorite: jest.Mock;
  listCleanerIds: jest.Mock;
  countByCleaner: jest.Mock;
  listByHost: jest.Mock;
}

function buildRepo(overrides: Partial<FakeRepo> = {}): FakeRepo {
  return {
    userExists: jest.fn().mockResolvedValue(true),
    isCleaner: jest.fn().mockResolvedValue(true),
    addUnderLock: jest.fn().mockResolvedValue(AddResult.CREATED),
    deleteFavorite: jest.fn().mockResolvedValue(undefined),
    existsFavorite: jest.fn().mockResolvedValue(false),
    listCleanerIds: jest.fn().mockResolvedValue([]),
    countByCleaner: jest.fn().mockResolvedValue(0),
    listByHost: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function tierReturning(tier: SubscriberTier): SubscriptionTierContract {
  return {
    getTier: jest.fn().mockResolvedValue(tier),
    getRoleTier: jest.fn().mockResolvedValue(tier),
  };
}

function allowPolicy(): FavoriteEligibilityPolicy {
  return { assertMayAdd: jest.fn().mockResolvedValue(undefined) } as unknown as FavoriteEligibilityPolicy;
}

function build(
  repo: FakeRepo,
  tier: SubscriberTier = SubscriberTier.FREE,
  policy: FavoriteEligibilityPolicy = allowPolicy(),
): { service: FavoritesService; cache: NoopFavoritesCacheService } {
  const cache = new NoopFavoritesCacheService();
  const service = new FavoritesService(
    repo as unknown as FavoritesRepository,
    tierReturning(tier),
    policy,
    cache,
  );
  return { service, cache };
}

const HOST = '11111111-1111-4111-8111-111111111111';
const CLEANER = '22222222-2222-4222-8222-222222222222';

describe('FavoritesService', () => {
  it('resolves the FREE tier for the HOST role when adding', async () => {
    const repo = buildRepo();
    const tier = tierReturning(SubscriberTier.FREE);
    const service = new FavoritesService(
      repo as unknown as FavoritesRepository,
      tier,
      allowPolicy(),
      new NoopFavoritesCacheService(),
    );
    await service.add(HOST, CLEANER);
    expect(tier.getRoleTier).toHaveBeenCalledWith(HOST, SubscriberRole.HOST);
  });

  it('CREATED invalidates the cache; ALREADY_EXISTS does not', async () => {
    const repo = buildRepo({ addUnderLock: jest.fn().mockResolvedValue(AddResult.ALREADY_EXISTS) });
    const { service, cache } = build(repo);
    const spy = jest.spyOn(cache, 'invalidate');
    const result = await service.add(HOST, CLEANER);
    expect(result).toBe(AddResult.ALREADY_EXISTS);
    expect(spy).not.toHaveBeenCalled();

    const repo2 = buildRepo({ addUnderLock: jest.fn().mockResolvedValue(AddResult.CREATED) });
    const built = build(repo2);
    const spy2 = jest.spyOn(built.cache, 'invalidate');
    await built.service.add(HOST, CLEANER);
    expect(spy2).toHaveBeenCalledWith(HOST);
  });

  it('throws 422 on OVER_LIMIT (no leak of any id)', async () => {
    const repo = buildRepo({ addUnderLock: jest.fn().mockResolvedValue(AddResult.OVER_LIMIT) });
    const { service } = build(repo);
    await expect(service.add(HOST, CLEANER)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects self-favorite (422) before touching the repo', async () => {
    const repo = buildRepo();
    const { service } = build(repo);
    await expect(service.add(HOST, HOST)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.addUnderLock).not.toHaveBeenCalled();
  });

  it('rejects an unknown user (404) and a non-Cleaner (422)', async () => {
    const unknown = buildRepo({ userExists: jest.fn().mockResolvedValue(false) });
    await expect(build(unknown).service.add(HOST, CLEANER)).rejects.toBeInstanceOf(NotFoundException);

    const nonCleaner = buildRepo({ isCleaner: jest.fn().mockResolvedValue(false) });
    await expect(build(nonCleaner).service.add(HOST, CLEANER)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('remove always resolves and invalidates the cache (idempotent 204)', async () => {
    const repo = buildRepo();
    const { service, cache } = build(repo);
    const spy = jest.spyOn(cache, 'invalidate');
    await expect(service.remove(HOST, CLEANER)).resolves.toBeUndefined();
    expect(repo.deleteFavorite).toHaveBeenCalledWith(HOST, CLEANER);
    expect(spy).toHaveBeenCalledWith(HOST);
  });

  it('PRO resolves to the (possibly unlimited) PRO limit; add is not blocked by the FREE cap', async () => {
    const repo = buildRepo({ addUnderLock: jest.fn().mockResolvedValue(AddResult.CREATED) });
    const { service } = build(repo, SubscriberTier.PRO);
    await service.add(HOST, CLEANER);
    // The limit passed to the repo is FAVORITES_PRO_MAX (null unless the env overrides it in test).
    const call = repo.addUnderLock.mock.calls[0];
    expect(call?.[0]).toBe(HOST);
    expect(call?.[1]).toBe(CLEANER);
  });

  it('listFavoriteCleanerIds returns ids only (Property 4 at the service boundary)', async () => {
    const ids = [CLEANER, '33333333-3333-4333-8333-333333333333'];
    const repo = buildRepo({ listCleanerIds: jest.fn().mockResolvedValue(ids) });
    const { service } = build(repo);
    await expect(service.listFavoriteCleanerIds(HOST)).resolves.toEqual(ids);
  });

  // Feature: favorites, Property 10: Response privacy and shape (aggregate count)
  it('P10: aggregateCountForCleaner returns a bare number (no host identities)', async () => {
    const repo = buildRepo({ countByCleaner: jest.fn().mockResolvedValue(3) });
    const { service } = build(repo);
    const count = await service.aggregateCountForCleaner(CLEANER);
    expect(typeof count).toBe('number');
    expect(count).toBe(3);
  });

  // Feature: favorites, Property 10: list returns only whitelisted safe display fields
  it('P10: listFavorites items expose only the whitelisted FavoriteView fields', async () => {
    const row = {
      cleaner_id: CLEANER,
      favorite_id: 'fav-1',
      display_name: 'Ana',
      full_name: 'Ana Fallback',
      photo_storage_key: 'key/ana.jpg',
      created_at: new Date('2024-01-01T00:00:00.000Z'),
      unavailable: false,
    };
    const repo = buildRepo({ listByHost: jest.fn().mockResolvedValue([row]) });
    const { service } = build(repo);
    const page = await service.listFavorites(HOST, { limit: 10, cursor: null });
    const item = page.items[0];
    expect(item).toBeDefined();
    expect(Object.keys(item ?? {}).sort()).toEqual(
      ['avatarUrl', 'cleanerId', 'displayName', 'favoritedAt', 'unavailable'].sort(),
    );
    // Never a host id or the raw full_name column name.
    expect(JSON.stringify(item)).not.toContain('host');
    expect(JSON.stringify(item)).not.toContain('full_name');
  });

  it('paginates with a nextCursor when more rows than the page limit exist', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      cleaner_id: `c-${i}`,
      favorite_id: `f-${i}`,
      display_name: `n-${i}`,
      full_name: null,
      photo_storage_key: null,
      created_at: new Date(2024, 0, 3 - i),
      unavailable: false,
    }));
    // limit=2 → repo returns limit+1=3; service trims to 2 and emits a cursor.
    const repo = buildRepo({ listByHost: jest.fn().mockResolvedValue(rows) });
    const { service } = build(repo);
    const page = await service.listFavorites(HOST, { limit: 2, cursor: null });
    expect(page.items.length).toBe(2);
    expect(page.nextCursor).not.toBeNull();
  });
});
