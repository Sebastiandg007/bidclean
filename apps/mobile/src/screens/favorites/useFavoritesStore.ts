/**
 * useFavoritesStore — Zustand store for favorites (one store per domain, Spec 22).
 *
 * Holds the paginated favorites list and an `isFavorite` map keyed by `cleanerId`. `toggle` applies
 * an OPTIMISTIC flip then reconciles via the API, reverting on failure (limit/network) with an i18n
 * error key; a `422` (OVER_LIMIT) sets `limitReached` so the UI can surface the limit banner + PRO
 * upsell. Membership authority stays server-side: the list / `is-favorite` reconcile the optimistic
 * state, and the store never grants authority locally.
 */

import { create } from 'zustand';

import {
  addFavoriteRequest,
  isFavoriteRequest,
  listFavoritesRequest,
  removeFavoriteRequest,
} from './favorites.api';
import { FAVORITES_I18N_KEYS } from './favorites.constants';
import type { FavoriteView } from './favorites.types';

export interface FavoritesStoreState {
  items: FavoriteView[];
  nextCursor: string | null;
  isFavoriteMap: Record<string, boolean>;
  isLoading: boolean;
  limitReached: boolean;
  error: string | null;
}

export interface FavoritesStoreActions {
  /** Load the first page of the Host's favorites (replaces the list). */
  loadFavorites: (limit?: number) => Promise<void>;
  /** Load the next page (appends), if any. */
  loadMore: (limit?: number) => Promise<void>;
  /** Optimistically toggle a favorite, then reconcile via `is-favorite`; revert on failure. */
  toggle: (cleanerId: string) => Promise<void>;
  /** Fetch and cache the authoritative toggle state for a single cleaner. */
  refreshIsFavorite: (cleanerId: string) => Promise<void>;
  /** Clear the transient limit/error flags (e.g. after dismissing the banner). */
  clearError: () => void;
  /** Reset to the initial state. */
  reset: () => void;
}

export type FavoritesStore = FavoritesStoreState & FavoritesStoreActions;

const initialState: FavoritesStoreState = {
  items: [],
  nextCursor: null,
  isFavoriteMap: {},
  isLoading: false,
  limitReached: false,
  error: null,
};

export const useFavoritesStore = create<FavoritesStore>((set, get) => ({
  ...initialState,

  loadFavorites: async (limit) => {
    set({ isLoading: true, error: null });
    try {
      const page = await listFavoritesRequest(limit, null);
      set({
        items: [...page.items],
        nextCursor: page.nextCursor,
        isFavoriteMap: mapFromItems(page.items),
        isLoading: false,
      });
    } catch {
      set({ isLoading: false, error: FAVORITES_I18N_KEYS.ERROR_GENERIC });
    }
  },

  loadMore: async (limit) => {
    const { nextCursor, isLoading } = get();
    if (nextCursor === null || isLoading) {
      return;
    }
    set({ isLoading: true, error: null });
    try {
      const page = await listFavoritesRequest(limit, nextCursor);
      const items = [...get().items, ...page.items];
      set({
        items,
        nextCursor: page.nextCursor,
        isFavoriteMap: { ...get().isFavoriteMap, ...mapFromItems(page.items) },
        isLoading: false,
      });
    } catch {
      set({ isLoading: false, error: FAVORITES_I18N_KEYS.ERROR_GENERIC });
    }
  },

  toggle: async (cleanerId) => {
    const wasFavorite = get().isFavoriteMap[cleanerId] === true;
    set({
      error: null,
      limitReached: false,
      isFavoriteMap: { ...get().isFavoriteMap, [cleanerId]: !wasFavorite },
    });
    try {
      if (wasFavorite) {
        await removeFavoriteRequest(cleanerId);
      } else {
        const result = await addFavoriteRequest(cleanerId);
        if (result === 'OVER_LIMIT') {
          revert(set, get, cleanerId, wasFavorite, FAVORITES_I18N_KEYS.ERROR_LIMIT, true);
          return;
        }
      }
      await get().refreshIsFavorite(cleanerId);
    } catch {
      revert(set, get, cleanerId, wasFavorite, FAVORITES_I18N_KEYS.ERROR_GENERIC, false);
    }
  },

  refreshIsFavorite: async (cleanerId) => {
    try {
      const isFavorite = await isFavoriteRequest(cleanerId);
      set({ isFavoriteMap: { ...get().isFavoriteMap, [cleanerId]: isFavorite } });
    } catch {
      // Reconciliation is best-effort; keep the optimistic value (recovered on the next attempt).
    }
  },

  clearError: () => {
    set({ error: null, limitReached: false });
  },

  reset: () => {
    set({ ...initialState });
  },
}));

/** Build an `isFavorite` map (all true) from a list page's items. */
function mapFromItems(items: readonly FavoriteView[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const item of items) {
    map[item.cleanerId] = true;
  }
  return map;
}

/** Revert an optimistic toggle to its prior value and surface an i18n error key. */
function revert(
  set: (partial: Partial<FavoritesStoreState>) => void,
  get: () => FavoritesStore,
  cleanerId: string,
  wasFavorite: boolean,
  errorKey: string,
  limitReached: boolean,
): void {
  set({
    isFavoriteMap: { ...get().isFavoriteMap, [cleanerId]: wasFavorite },
    error: errorKey,
    limitReached,
  });
}

/** Convenience hook returning the full favorites store. */
export function useFavorites(): FavoritesStore {
  return useFavoritesStore();
}

/**
 * The has-favorites signal for the publish "offer to favorites first" control (Spec 7 owns the
 * control; favorites only supplies whether the Host currently has any favorite). Reflects the loaded
 * list, so the publish UX can disable/hint the choice when the Host has none.
 */
export function useHasFavorites(): boolean {
  return useFavoritesStore((store) => store.items.length > 0);
}

export default useFavorites;
