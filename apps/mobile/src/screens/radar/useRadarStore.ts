/**
 * useRadarStore — Zustand store for the Cleaner's Offer Radar.
 *
 * Manages:
 * - Available offers (Map<offerId, RadarOffer>)
 * - Event timestamps for temporal ordering (Map<offerId, changedAt>)
 * - Server-side filters and sort option
 * - View mode (map/list), connection status, pagination
 * - REST actions: fetch, refresh, load more
 * - WebSocket event handlers (idempotent): handleOfferNew, handleOfferStatusChanged
 * - Reconciliation: REST snapshot replaces all local state
 * - Computed selectors: GeoJSON, sorted list, active filter count
 */

import { create } from 'zustand';

import type {
  RadarOffer,
  RadarFilters,
  ViewMode,
  SortOption,
  ConnectionStatus,
  RadarPagination,
  OfferFeature,
  OfferFeatureCollection,
} from './radar.types';
import { EMPTY_FILTERS } from './radar.types';
import { RADAR_PAGE_SIZE } from './radar.constants';
import { fetchAvailableOffers, fetchSnapshot } from './radar.api';

// ─── Store Interface ─────────────────────────────────────────────────────────

export interface RadarState {
  offers: Map<string, RadarOffer>;
  offerEventTimestamps: Map<string, string>;
  filters: RadarFilters;
  sort: SortOption;
  viewMode: ViewMode;
  connectionStatus: ConnectionStatus;
  isLoading: boolean;
  isRefreshing: boolean;
  pagination: RadarPagination;
  selectedOfferId: string | null;
  lastSuccessfulSyncAt: string | null;
  lastWebSocketEventAt: string | null;
  /** Last error message from REST operations (cleared on next successful fetch) */
  error: string | null;
}

export interface RadarActions {
  // REST actions
  fetchAvailableOffers: (page?: number) => Promise<void>;
  refreshOffers: () => Promise<void>;
  loadMoreOffers: () => Promise<void>;

  // WebSocket event handlers (IDEMPOTENT)
  handleOfferNew: (offer: RadarOffer) => void;
  handleOfferStatusChanged: (offerId: string, state: string, changedAt: string) => void;

  // Reconciliation
  reconcile: () => Promise<void>;

  // Filter actions
  setFilters: (filters: Partial<RadarFilters>) => void;
  clearFilters: () => void;
  setSort: (sort: SortOption) => void;

  // UI actions
  setViewMode: (mode: ViewMode) => void;
  selectOffer: (offerId: string | null) => void;
  markOfferViewed: (offerId: string) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  markAllStale: () => void;

  // Error handling
  clearError: () => void;

  // Computed selectors
  getOffersAsGeoJSON: () => OfferFeatureCollection;
  getOffersList: () => RadarOffer[];
  getActiveFilterCount: () => number;
}

export type RadarStore = RadarState & RadarActions;

// ─── Initial State ───────────────────────────────────────────────────────────

const initialState: RadarState = {
  offers: new Map(),
  offerEventTimestamps: new Map(),
  filters: { ...EMPTY_FILTERS },
  sort: 'distance_asc',
  viewMode: 'map',
  connectionStatus: 'disconnected',
  isLoading: false,
  isRefreshing: false,
  pagination: { page: 1, totalPages: 1, total: 0 },
  selectedOfferId: null,
  lastSuccessfulSyncAt: null,
  lastWebSocketEventAt: null,
  error: null,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function offersMapToGeoJSON(offers: Map<string, RadarOffer>): OfferFeatureCollection {
  const features: OfferFeature[] = [];

  for (const [id, offer] of offers) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [offer.publicLocation.lng, offer.publicLocation.lat],
      },
      properties: {
        offerId: id,
        serviceType: offer.serviceType,
        payoutCents: offer.priceBreakdown.payoutCents,
        isUrgent: offer.isUrgent,
        isViewed: offer.isViewed,
        isStale: offer.isStale,
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

function sortOffers(offers: RadarOffer[], sort: SortOption): RadarOffer[] {
  const sorted = [...offers];

  switch (sort) {
    case 'distance_asc':
      sorted.sort((a, b) => a.distanceMeters - b.distanceMeters);
      break;
    case 'price_desc':
      sorted.sort((a, b) => b.priceBreakdown.payoutCents - a.priceBreakdown.payoutCents);
      break;
    case 'scheduled_asc':
      sorted.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
      break;
    case 'published_desc':
      sorted.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
      break;
  }

  return sorted;
}

function countActiveFilters(filters: RadarFilters): number {
  let count = 0;

  if (filters.serviceTypes.length > 0) count++;
  if (filters.minPriceCents !== null) count++;
  if (filters.maxPriceCents !== null) count++;
  if (filters.maxDistanceMeters !== null) count++;
  if (filters.scheduledAfter !== null) count++;
  if (filters.scheduledBefore !== null) count++;

  return count;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useRadarStore = create<RadarStore>((set, get) => ({
  ...initialState,

  // ─── REST Actions ────────────────────────────────────────────────────────

  fetchAvailableOffers: async (page = 1) => {
    const { filters, sort } = get();

    set({ isLoading: true, error: null });

    try {
      const response = await fetchAvailableOffers({
        filters,
        sort,
        page,
        limit: RADAR_PAGE_SIZE,
      });

      const newOffers = new Map<string, RadarOffer>();

      for (const offer of response.items) {
        newOffers.set(offer.offerId, {
          ...offer,
          isViewed: false,
          isStale: false,
        });
      }

      set({
        offers: newOffers,
        pagination: {
          page: response.pagination.page,
          totalPages: response.pagination.totalPages,
          total: response.pagination.total,
        },
        isLoading: false,
        error: null,
        lastSuccessfulSyncAt: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'radar.error.fetchFailed';
      set({ isLoading: false, error: message });
    }
  },

  refreshOffers: async () => {
    const { filters, sort, offers: existingOffers } = get();

    set({ isRefreshing: true, error: null });

    try {
      const response = await fetchAvailableOffers({
        filters,
        sort,
        page: 1,
        limit: RADAR_PAGE_SIZE,
      });

      const newOffers = new Map<string, RadarOffer>();

      for (const offer of response.items) {
        // Preserve isViewed state from existing offers (don't reset on refresh)
        const wasViewed = existingOffers.get(offer.offerId)?.isViewed ?? false;
        newOffers.set(offer.offerId, {
          ...offer,
          isViewed: wasViewed,
          isStale: false,
        });
      }

      set({
        offers: newOffers,
        pagination: {
          page: response.pagination.page,
          totalPages: response.pagination.totalPages,
          total: response.pagination.total,
        },
        isRefreshing: false,
        error: null,
        lastSuccessfulSyncAt: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'radar.error.refreshFailed';
      set({ isRefreshing: false, error: message });
    }
  },

  loadMoreOffers: async () => {
    const { pagination, filters, sort, offers } = get();

    if (pagination.page >= pagination.totalPages) {
      return;
    }

    const nextPage = pagination.page + 1;

    set({ isLoading: true });

    try {
      const response = await fetchAvailableOffers({
        filters,
        sort,
        page: nextPage,
        limit: RADAR_PAGE_SIZE,
      });

      // Append new offers to existing map (don't replace)
      const updatedOffers = new Map(offers);

      for (const offer of response.items) {
        updatedOffers.set(offer.offerId, {
          ...offer,
          isViewed: false,
          isStale: false,
        });
      }

      set({
        offers: updatedOffers,
        pagination: {
          page: response.pagination.page,
          totalPages: response.pagination.totalPages,
          total: response.pagination.total,
        },
        isLoading: false,
        error: null,
        lastSuccessfulSyncAt: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'radar.error.loadMoreFailed';
      set({ isLoading: false, error: message });
    }
  },

  // ─── WebSocket Event Handlers (IDEMPOTENT) ───────────────────────────────

  handleOfferNew: (offer) => {
    const { offers } = get();
    const updatedOffers = new Map(offers);

    // Upsert: insert if new, update if exists
    // Processing the same event N times produces exactly one entry
    updatedOffers.set(offer.offerId, {
      ...offer,
      isViewed: updatedOffers.get(offer.offerId)?.isViewed ?? false,
      isStale: false,
    });

    set({
      offers: updatedOffers,
      lastWebSocketEventAt: new Date().toISOString(),
    });
  },

  handleOfferStatusChanged: (offerId, _state, changedAt) => {
    const { offers, offerEventTimestamps } = get();

    // Temporal ordering: only apply if changedAt > existing timestamp
    const existingTimestamp = offerEventTimestamps.get(offerId);

    if (existingTimestamp && changedAt <= existingTimestamp) {
      // Older event — discard
      return;
    }

    // Update the event timestamp
    const updatedTimestamps = new Map(offerEventTimestamps);
    updatedTimestamps.set(offerId, changedAt);

    // Remove the offer from the map (terminal state: CANCELLED/EXPIRED/MATCHED)
    const updatedOffers = new Map(offers);
    updatedOffers.delete(offerId);

    set({
      offers: updatedOffers,
      offerEventTimestamps: updatedTimestamps,
      lastWebSocketEventAt: new Date().toISOString(),
    });
  },

  // ─── Reconciliation ──────────────────────────────────────────────────────

  reconcile: async () => {
    try {
      const response = await fetchSnapshot();

      // REST always wins: replace all local offers with server snapshot
      const reconciledOffers = new Map<string, RadarOffer>();

      for (const offer of response.offers) {
        reconciledOffers.set(offer.offerId, {
          ...offer,
          isViewed: false,
          isStale: false,
        });
      }

      // Clear event timestamps since we have fresh authoritative state
      set({
        offers: reconciledOffers,
        offerEventTimestamps: new Map(),
        lastSuccessfulSyncAt: response.syncedAt,
      });
    } catch {
      // Reconciliation failed — keep existing state (stale data better than no data)
    }
  },

  // ─── Filter Actions ──────────────────────────────────────────────────────

  setFilters: (newFilters) => {
    const { filters } = get();
    const merged: RadarFilters = { ...filters, ...newFilters };

    set({ filters: merged });

    // Trigger re-fetch with new filters (resets to page 1)
    get().fetchAvailableOffers(1);
  },

  clearFilters: () => {
    set({ filters: { ...EMPTY_FILTERS } });

    // Trigger re-fetch without filters
    get().fetchAvailableOffers(1);
  },

  setSort: (sort) => {
    set({ sort });

    // Trigger re-fetch with new sort (resets to page 1)
    get().fetchAvailableOffers(1);
  },

  // ─── UI Actions ──────────────────────────────────────────────────────────

  setViewMode: (mode) => {
    set({ viewMode: mode });
  },

  selectOffer: (offerId) => {
    set({ selectedOfferId: offerId });
  },

  markOfferViewed: (offerId) => {
    const { offers } = get();
    const offer = offers.get(offerId);

    if (!offer) return;

    const updatedOffers = new Map(offers);
    updatedOffers.set(offerId, { ...offer, isViewed: true });

    set({ offers: updatedOffers });
  },

  setConnectionStatus: (status) => {
    set({ connectionStatus: status });
  },

  markAllStale: () => {
    const { offers } = get();
    const staleOffers = new Map<string, RadarOffer>();

    for (const [id, offer] of offers) {
      staleOffers.set(id, { ...offer, isStale: true });
    }

    set({ offers: staleOffers });
  },

  // ─── Error Handling ───────────────────────────────────────────────────

  clearError: () => {
    set({ error: null });
  },

  // ─── Computed Selectors ──────────────────────────────────────────────────

  getOffersAsGeoJSON: () => {
    const { offers } = get();
    return offersMapToGeoJSON(offers);
  },

  getOffersList: () => {
    const { offers, sort } = get();
    const offerArray = Array.from(offers.values());
    return sortOffers(offerArray, sort);
  },

  getActiveFilterCount: () => {
    const { filters } = get();
    return countActiveFilters(filters);
  },
}));

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Convenience hook that returns all radar store state and actions.
 */
export function useRadar(): RadarStore {
  return useRadarStore();
}

export default useRadar;
