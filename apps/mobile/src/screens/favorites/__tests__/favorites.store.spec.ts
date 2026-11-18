/**
 * Unit tests for the favorites store (Spec 22 · Property 3 at the client): optimistic toggle
 * reconciled via `is-favorite`, revert on failure with an i18n error key, and the limit banner
 * signal on a `422` (OVER_LIMIT). The api layer is mocked (zero real network).
 */

jest.mock('../favorites.api', () => ({
  addFavoriteRequest: jest.fn(),
  removeFavoriteRequest: jest.fn(),
  listFavoritesRequest: jest.fn(),
  isFavoriteRequest: jest.fn(),
  aggregateCountRequest: jest.fn(),
}));

import {
  addFavoriteRequest,
  isFavoriteRequest,
  listFavoritesRequest,
  removeFavoriteRequest,
} from '../favorites.api';
import { useFavoritesStore } from '../useFavoritesStore';
import type { FavoriteView } from '../favorites.types';

const mockAdd = addFavoriteRequest as jest.Mock;
const mockRemove = removeFavoriteRequest as jest.Mock;
const mockList = listFavoritesRequest as jest.Mock;
const mockIsFavorite = isFavoriteRequest as jest.Mock;

function favorite(overrides: Partial<FavoriteView> = {}): FavoriteView {
  return {
    cleanerId: 'cleaner-1',
    displayName: 'Ana',
    avatarUrl: null,
    favoritedAt: new Date().toISOString(),
    unavailable: false,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useFavoritesStore.getState().reset();
});

describe('useFavoritesStore', () => {
  it('loads the first page and builds the isFavorite map', async () => {
    mockList.mockResolvedValue({ items: [favorite({ cleanerId: 'c-1' })], nextCursor: 'cur-1' });
    await useFavoritesStore.getState().loadFavorites();
    const state = useFavoritesStore.getState();
    expect(state.items.length).toBe(1);
    expect(state.isFavoriteMap['c-1']).toBe(true);
    expect(state.nextCursor).toBe('cur-1');
  });

  it('optimistically adds then reconciles via is-favorite', async () => {
    mockAdd.mockResolvedValue('CREATED');
    mockIsFavorite.mockResolvedValue(true);
    await useFavoritesStore.getState().toggle('c-2');
    expect(mockAdd).toHaveBeenCalledWith('c-2');
    expect(useFavoritesStore.getState().isFavoriteMap['c-2']).toBe(true);
  });

  it('optimistically removes an existing favorite then reconciles', async () => {
    mockList.mockResolvedValue({ items: [favorite({ cleanerId: 'c-3' })], nextCursor: null });
    await useFavoritesStore.getState().loadFavorites();
    mockRemove.mockResolvedValue(undefined);
    mockIsFavorite.mockResolvedValue(false);
    await useFavoritesStore.getState().toggle('c-3');
    expect(mockRemove).toHaveBeenCalledWith('c-3');
    expect(useFavoritesStore.getState().isFavoriteMap['c-3']).toBe(false);
  });

  it('surfaces the limit banner and reverts the optimistic flip on OVER_LIMIT', async () => {
    mockAdd.mockResolvedValue('OVER_LIMIT');
    await useFavoritesStore.getState().toggle('c-4');
    const state = useFavoritesStore.getState();
    expect(state.limitReached).toBe(true);
    expect(state.error).toBe('favorites.error.limit');
    // Reverted: not favorited.
    expect(state.isFavoriteMap['c-4']).toBe(false);
    // is-favorite reconcile is NOT called after a limit rejection.
    expect(mockIsFavorite).not.toHaveBeenCalled();
  });

  it('reverts with a generic i18n error on a network failure', async () => {
    mockAdd.mockRejectedValue(new Error('network'));
    await useFavoritesStore.getState().toggle('c-5');
    const state = useFavoritesStore.getState();
    expect(state.error).toBe('favorites.error.generic');
    expect(state.isFavoriteMap['c-5']).toBe(false);
  });

  it('keeps the optimistic value when the reconcile call itself fails (best-effort)', async () => {
    mockAdd.mockResolvedValue('CREATED');
    mockIsFavorite.mockRejectedValue(new Error('reconcile down'));
    await useFavoritesStore.getState().toggle('c-6');
    // Optimistic add stands; recovered on the next attempt.
    expect(useFavoritesStore.getState().isFavoriteMap['c-6']).toBe(true);
  });

  it('loadMore appends the next page and merges the map', async () => {
    mockList
      .mockResolvedValueOnce({ items: [favorite({ cleanerId: 'a' })], nextCursor: 'cur-1' })
      .mockResolvedValueOnce({ items: [favorite({ cleanerId: 'b' })], nextCursor: null });
    await useFavoritesStore.getState().loadFavorites();
    await useFavoritesStore.getState().loadMore();
    const state = useFavoritesStore.getState();
    expect(state.items.map((i) => i.cleanerId)).toEqual(['a', 'b']);
    expect(state.nextCursor).toBeNull();
  });

  it('clearError resets the transient limit + error flags', async () => {
    mockAdd.mockResolvedValue('OVER_LIMIT');
    await useFavoritesStore.getState().toggle('c-7');
    useFavoritesStore.getState().clearError();
    const state = useFavoritesStore.getState();
    expect(state.error).toBeNull();
    expect(state.limitReached).toBe(false);
  });
});
