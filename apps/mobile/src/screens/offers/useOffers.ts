/**
 * useOffers — Zustand store hook + API calls for offers CRUD, pagination,
 * real-time sync, and optimistic updates.
 *
 * Manages the full offer lifecycle from the Host's perspective:
 * - Create offer (DRAFT) with idempotency key
 * - Publish offer with favorites-first delivery option
 * - Cancel offer with optimistic state update
 * - Fetch paginated offer list with state filter
 * - Fetch offer detail with state history
 * - Get price breakdown for a specific offer
 * - Handle real-time cancellation events (Centrifugo)
 */

import { create } from 'zustand';
import * as Crypto from 'expo-crypto';

import type {
  Offer,
  OfferState,
  PriceBreakdown,
  CreateOfferPayload,
  CreateOfferResponse,
  OffersListResponse,
} from './offers.types';

// ─── Constants ───────────────────────────────────────────────────────────────

const ENDPOINTS = {
  OFFERS: '/offers',
  PUBLISH: (id: string) => `/offers/${id}/publish`,
  CANCEL: (id: string) => `/offers/${id}/cancel`,
  DETAIL: (id: string) => `/offers/${id}`,
  PRICE_BREAKDOWN: (id: string) => `/offers/${id}/price-breakdown`,
} as const;

const PAGE_SIZE = 20;

const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/** i18n error keys for offer operations */
const ERROR_KEYS = {
  CREATE: 'offers.error.create_failed',
  PUBLISH: 'offers.error.publish_failed',
  CANCEL: 'offers.error.cancel_failed',
  FETCH_LIST: 'offers.error.fetch_list_failed',
  FETCH_DETAIL: 'offers.error.fetch_detail_failed',
  PRICE_BREAKDOWN: 'offers.error.price_breakdown_failed',
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getApiClient() {
  const { apiClient } = await import('../../services/api.service');
  return apiClient;
}

function extractErrorMessage(err: unknown, fallbackKey: string): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallbackKey;
}

/** Generate a cryptographically random idempotency key using expo-crypto */
async function generateIdempotencyKey(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(16);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── State Types ─────────────────────────────────────────────────────────────

export interface OffersState {
  offers: Offer[];
  selectedOffer: Offer | null;
  priceBreakdown: PriceBreakdown | null;
  isLoading: boolean;
  isCreating: boolean;
  isPublishing: boolean;
  isCancelling: boolean;
  error: string | null;
  page: number;
  totalPages: number;
  hasMore: boolean;
  filterState: OfferState | null;
}

export interface OffersActions {
  createOffer: (payload: CreateOfferPayload) => Promise<string | null>;
  publishOffer: (offerId: string, favoritesFirst: boolean) => Promise<void>;
  cancelOffer: (offerId: string) => Promise<void>;
  fetchOffers: (state?: OfferState | null, page?: number) => Promise<void>;
  fetchOfferDetail: (offerId: string) => Promise<void>;
  getPriceBreakdown: (offerId: string) => Promise<void>;
  handleOfferCancelled: (offerId: string) => void;
  reset: () => void;
}

export type OffersStore = OffersState & OffersActions;

// ─── Initial State ───────────────────────────────────────────────────────────

const initialState: OffersState = {
  offers: [],
  selectedOffer: null,
  priceBreakdown: null,
  isLoading: false,
  isCreating: false,
  isPublishing: false,
  isCancelling: false,
  error: null,
  page: 1,
  totalPages: 1,
  hasMore: false,
  filterState: null,
};

// ─── Store ───────────────────────────────────────────────────────────────────

export const useOffersStore = create<OffersStore>((set, get) => ({
  ...initialState,

  createOffer: async (payload) => {
    set({ isCreating: true, error: null });

    try {
      const client = await getApiClient();
      const idempotencyKey = await generateIdempotencyKey();

      const response = await client.post<CreateOfferResponse>(
        ENDPOINTS.OFFERS,
        payload,
        { headers: { [IDEMPOTENCY_HEADER]: idempotencyKey } },
      );

      set({ isCreating: false });
      return response.data.id;
    } catch (err) {
      set({
        error: extractErrorMessage(err, ERROR_KEYS.CREATE),
        isCreating: false,
      });
      return null;
    }
  },

  publishOffer: async (offerId, favoritesFirst) => {
    set({ isPublishing: true, error: null });

    try {
      const client = await getApiClient();
      await client.post(ENDPOINTS.PUBLISH(offerId), { favoritesFirst });

      // Update local state: transition offer to PUBLISHED
      const { offers, selectedOffer } = get();
      const updatedOffers = offers.map((offer) =>
        offer.id === offerId
          ? { ...offer, state: 'PUBLISHED' as OfferState, favoritesFirst }
          : offer,
      );

      set({
        offers: updatedOffers,
        selectedOffer:
          selectedOffer?.id === offerId
            ? { ...selectedOffer, state: 'PUBLISHED', favoritesFirst }
            : selectedOffer,
        isPublishing: false,
      });
    } catch (err) {
      set({
        error: extractErrorMessage(err, ERROR_KEYS.PUBLISH),
        isPublishing: false,
      });
    }
  },

  cancelOffer: async (offerId) => {
    const { offers, selectedOffer } = get();

    // Optimistic update: set state to CANCELLED immediately
    const previousOffers = offers;
    const previousSelectedOffer = selectedOffer;

    const optimisticOffers = offers.map((offer) =>
      offer.id === offerId
        ? { ...offer, state: 'CANCELLED' as OfferState, cancelledAt: new Date().toISOString() }
        : offer,
    );
    const optimisticSelected =
      selectedOffer?.id === offerId
        ? { ...selectedOffer, state: 'CANCELLED' as OfferState, cancelledAt: new Date().toISOString() }
        : selectedOffer;

    set({
      offers: optimisticOffers,
      selectedOffer: optimisticSelected,
      isCancelling: true,
      error: null,
    });

    try {
      const client = await getApiClient();
      await client.post(ENDPOINTS.CANCEL(offerId));
      set({ isCancelling: false });
    } catch (err) {
      // Rollback optimistic update on failure
      set({
        offers: previousOffers,
        selectedOffer: previousSelectedOffer,
        error: extractErrorMessage(err, ERROR_KEYS.CANCEL),
        isCancelling: false,
      });
    }
  },

  fetchOffers: async (stateFilter, page = 1) => {
    set({ isLoading: true, error: null });

    try {
      const client = await getApiClient();

      const params: Record<string, string | number> = {
        page,
        pageSize: PAGE_SIZE,
      };

      if (stateFilter) {
        params.state = stateFilter;
      }

      const response = await client.get<OffersListResponse>(ENDPOINTS.OFFERS, { params });
      const { data, totalPages, hasMore } = response.data;
      const responsePage = response.data.page;

      set((prev) => ({
        offers: responsePage > 1 ? [...prev.offers, ...data] : data,
        page: responsePage,
        totalPages,
        hasMore,
        filterState: stateFilter ?? null,
        isLoading: false,
      }));
    } catch (err) {
      set({
        error: extractErrorMessage(err, ERROR_KEYS.FETCH_LIST),
        isLoading: false,
      });
    }
  },

  fetchOfferDetail: async (offerId) => {
    set({ isLoading: true, error: null });

    try {
      const client = await getApiClient();
      const response = await client.get<Offer>(ENDPOINTS.DETAIL(offerId));

      set({ selectedOffer: response.data, isLoading: false });
    } catch (err) {
      set({
        error: extractErrorMessage(err, ERROR_KEYS.FETCH_DETAIL),
        isLoading: false,
      });
    }
  },

  getPriceBreakdown: async (offerId) => {
    set({ error: null });

    try {
      const client = await getApiClient();
      const response = await client.get<PriceBreakdown>(
        ENDPOINTS.PRICE_BREAKDOWN(offerId),
      );

      set({ priceBreakdown: response.data });
    } catch (err) {
      set({
        error: extractErrorMessage(err, ERROR_KEYS.PRICE_BREAKDOWN),
      });
    }
  },

  handleOfferCancelled: (offerId) => {
    const { offers, selectedOffer } = get();

    const updatedOffers = offers.map((offer) =>
      offer.id === offerId
        ? { ...offer, state: 'CANCELLED' as OfferState, cancelledAt: new Date().toISOString() }
        : offer,
    );

    set({
      offers: updatedOffers,
      selectedOffer:
        selectedOffer?.id === offerId
          ? { ...selectedOffer, state: 'CANCELLED', cancelledAt: new Date().toISOString() }
          : selectedOffer,
    });
  },

  reset: () => {
    set(initialState);
  },
}));

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Convenience hook that returns all offers store state and actions.
 */
export function useOffers(): OffersStore {
  return useOffersStore();
}

export default useOffers;
