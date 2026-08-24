/**
 * useProperties — Zustand store hook + API calls for property management.
 *
 * Manages all property-related state and operations:
 * - Paginated listing with search and type filter
 * - CRUD operations (create, read, update, soft delete)
 * - Photo management (upload, delete, reorder)
 * - Geocoding (forward and reverse via Mapbox proxy)
 *
 * Each mutation uses Idempotency-Key headers to prevent
 * duplicate operations on mobile retry/timeout scenarios.
 */

import { create } from 'zustand';
import type {
  Property,
  PropertyListItem,
  PaginatedProperties,
  CreatePropertyPayload,
  UpdatePropertyPayload,
  GeocodeRequest,
  GeocodeResponse,
  ReverseGeocodeRequest,
  ReverseGeocodeResponse,
  ReorderPhotosPayload,
  PropertyListQuery,
} from './properties.types';
import { DEFAULT_PAGE_SIZE, PROPERTY_UPLOAD_TIMEOUT_MS } from './properties.constants';

// ─── Constants ───────────────────────────────────────────────────────────────

const ENDPOINTS = {
  PROPERTIES: '/properties',
  PROPERTY_DETAIL: (id: string) => `/properties/${id}`,
  PHOTOS: (id: string) => `/properties/${id}/photos`,
  PHOTO_DETAIL: (id: string, photoId: string) => `/properties/${id}/photos/${photoId}`,
  PHOTOS_ORDER: (id: string) => `/properties/${id}/photos/order`,
  GEOCODE: '/properties/geocode',
  REVERSE_GEOCODE: '/properties/reverse-geocode',
} as const;

/** i18n error keys for property operations */
const ERROR_KEYS = {
  FETCH_LIST: 'properties.error.fetch_list_failed',
  FETCH_DETAIL: 'properties.error.fetch_detail_failed',
  CREATE: 'properties.error.create_failed',
  UPDATE: 'properties.error.update_failed',
  DELETE: 'properties.error.delete_failed',
  UPLOAD_PHOTO: 'properties.error.upload_photo_failed',
  DELETE_PHOTO: 'properties.error.delete_photo_failed',
  REORDER: 'properties.error.reorder_failed',
  GEOCODE: 'properties.error.geocode_failed',
  REVERSE_GEOCODE: 'properties.error.reverse_geocode_failed',
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Lazy-load the API client to avoid circular imports */
async function getApiClient() {
  const { apiClient } = await import('../../services/api.service');
  return apiClient;
}

/** Extract a human-readable error message or fall back to an i18n key */
function extractErrorMessage(err: unknown, fallbackKey: string): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallbackKey;
}

/** Generate a UUID v4 idempotency key */
function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Manual UUID v4 fallback (RFC 4122 compliant)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ─── Types ───────────────────────────────────────────────────────────────────

/** Properties store state */
export interface PropertiesState {
  /** Paginated property list items */
  items: PropertyListItem[];
  /** Total count of properties */
  total: number;
  /** Currently selected property detail */
  selectedProperty: Property | null;
  /** Loading state for list operations */
  isListLoading: boolean;
  /** Loading state for detail operations */
  isDetailLoading: boolean;
  /** Loading state for mutations */
  isMutating: boolean;
  /** Error message (i18n key or null) */
  error: string | null;
  /** Current page number */
  currentPage: number;
  /** Total pages available */
  totalPages: number;
}

/** Properties store actions */
export interface PropertiesActions {
  /** Fetch paginated property list with optional search/type filter */
  fetchList: (query?: PropertyListQuery) => Promise<void>;
  /** Fetch full property detail by ID */
  fetchDetail: (propertyId: string) => Promise<void>;
  /** Create a new property (returns created entity) */
  createProperty: (payload: CreatePropertyPayload) => Promise<Property | null>;
  /** Partial update of a property */
  updateProperty: (propertyId: string, payload: UpdatePropertyPayload) => Promise<void>;
  /** Soft delete a property */
  deleteProperty: (propertyId: string) => Promise<void>;
  /** Upload a photo for a property */
  uploadPhoto: (propertyId: string, imageUri: string) => Promise<void>;
  /** Delete a photo by ID */
  deletePhoto: (propertyId: string, photoId: string) => Promise<void>;
  /** Reorder photos for a property */
  reorderPhotos: (propertyId: string, payload: ReorderPhotosPayload) => Promise<void>;
  /** Forward geocoding (address → coordinates) */
  geocode: (request: GeocodeRequest) => Promise<GeocodeResponse | null>;
  /** Reverse geocoding (coordinates → address) */
  reverseGeocode: (request: ReverseGeocodeRequest) => Promise<ReverseGeocodeResponse | null>;
  /** Clear current error */
  clearError: () => void;
  /** Reset store to initial state */
  reset: () => void;
}

export type PropertiesStore = PropertiesState & PropertiesActions;

// ─── Initial State ───────────────────────────────────────────────────────────

const initialState: PropertiesState = {
  items: [],
  total: 0,
  selectedProperty: null,
  isListLoading: false,
  isDetailLoading: false,
  isMutating: false,
  error: null,
  currentPage: 1,
  totalPages: 0,
};

// ─── Store ───────────────────────────────────────────────────────────────────

export const usePropertiesStore = create<PropertiesStore>((set, get) => ({
  ...initialState,

  fetchList: async (query?: PropertyListQuery) => {
    set({ isListLoading: true, error: null });

    try {
      const client = await getApiClient();
      const response = await client.get<PaginatedProperties>(ENDPOINTS.PROPERTIES, {
        params: {
          page: query?.page ?? 1,
          limit: query?.limit ?? DEFAULT_PAGE_SIZE,
          search: query?.search,
          type: query?.type,
        },
      });

      const { items, total, page, totalPages } = response.data;
      set({ items, total, currentPage: page, totalPages, isListLoading: false });
    } catch (err) {
      set({ error: extractErrorMessage(err, ERROR_KEYS.FETCH_LIST), isListLoading: false });
    }
  },

  fetchDetail: async (propertyId: string) => {
    set({ isDetailLoading: true, error: null });

    try {
      const client = await getApiClient();
      const response = await client.get<Property>(ENDPOINTS.PROPERTY_DETAIL(propertyId));
      set({ selectedProperty: response.data, isDetailLoading: false });
    } catch (err) {
      set({ error: extractErrorMessage(err, ERROR_KEYS.FETCH_DETAIL), isDetailLoading: false });
    }
  },

  createProperty: async (payload: CreatePropertyPayload) => {
    set({ isMutating: true, error: null });

    try {
      const client = await getApiClient();
      const response = await client.post<Property>(ENDPOINTS.PROPERTIES, payload, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      });

      set({ isMutating: false });
      return response.data;
    } catch (err) {
      const message = extractErrorMessage(err, ERROR_KEYS.CREATE);
      set({ error: message, isMutating: false });
      throw err;
    }
  },

  updateProperty: async (propertyId: string, payload: UpdatePropertyPayload) => {
    set({ isMutating: true, error: null });

    try {
      const client = await getApiClient();
      const response = await client.patch<Property>(
        ENDPOINTS.PROPERTY_DETAIL(propertyId),
        payload,
      );

      set({ selectedProperty: response.data, isMutating: false });
    } catch (err) {
      const message = extractErrorMessage(err, ERROR_KEYS.UPDATE);
      set({ error: message, isMutating: false });
      throw err;
    }
  },

  deleteProperty: async (propertyId: string) => {
    set({ isMutating: true, error: null });

    try {
      const client = await getApiClient();
      await client.delete(ENDPOINTS.PROPERTY_DETAIL(propertyId));

      set({ isMutating: false });
      await get().fetchList({ page: get().currentPage });
    } catch (err) {
      const message = extractErrorMessage(err, ERROR_KEYS.DELETE);
      set({ error: message, isMutating: false });
      throw err;
    }
  },

  uploadPhoto: async (propertyId: string, imageUri: string) => {
    set({ isMutating: true, error: null });

    try {
      const client = await getApiClient();
      const formData = new FormData();

      formData.append('file', {
        uri: imageUri,
        type: 'image/jpeg',
        name: 'property-photo.jpg',
      } as unknown as Blob);

      await client.post(ENDPOINTS.PHOTOS(propertyId), formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'Idempotency-Key': generateIdempotencyKey(),
        },
        timeout: PROPERTY_UPLOAD_TIMEOUT_MS,
      });

      set({ isMutating: false });
      await get().fetchDetail(propertyId);
    } catch (err) {
      const message = extractErrorMessage(err, ERROR_KEYS.UPLOAD_PHOTO);
      set({ error: message, isMutating: false });
      throw err;
    }
  },

  deletePhoto: async (propertyId: string, photoId: string) => {
    set({ isMutating: true, error: null });

    try {
      const client = await getApiClient();
      await client.delete(ENDPOINTS.PHOTO_DETAIL(propertyId, photoId));

      set({ isMutating: false });
      await get().fetchDetail(propertyId);
    } catch (err) {
      const message = extractErrorMessage(err, ERROR_KEYS.DELETE_PHOTO);
      set({ error: message, isMutating: false });
      throw err;
    }
  },

  reorderPhotos: async (propertyId: string, payload: ReorderPhotosPayload) => {
    set({ isMutating: true, error: null });

    try {
      const client = await getApiClient();
      await client.patch(ENDPOINTS.PHOTOS_ORDER(propertyId), payload);

      set({ isMutating: false });
      await get().fetchDetail(propertyId);
    } catch (err) {
      const message = extractErrorMessage(err, ERROR_KEYS.REORDER);
      set({ error: message, isMutating: false });
      throw err;
    }
  },

  geocode: async (request: GeocodeRequest) => {
    set({ error: null });

    try {
      const client = await getApiClient();
      const response = await client.post<GeocodeResponse>(ENDPOINTS.GEOCODE, request);
      return response.data;
    } catch (err) {
      const message = extractErrorMessage(err, ERROR_KEYS.GEOCODE);
      set({ error: message });
      throw err;
    }
  },

  reverseGeocode: async (request: ReverseGeocodeRequest) => {
    set({ error: null });

    try {
      const client = await getApiClient();
      const response = await client.post<ReverseGeocodeResponse>(
        ENDPOINTS.REVERSE_GEOCODE,
        request,
      );
      return response.data;
    } catch (err) {
      const message = extractErrorMessage(err, ERROR_KEYS.REVERSE_GEOCODE);
      set({ error: message });
      throw err;
    }
  },

  clearError: () => {
    set({ error: null });
  },

  reset: () => {
    set(initialState);
  },
}));

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Convenience hook that returns all properties store state and actions.
 */
export function useProperties(): PropertiesStore {
  return usePropertiesStore();
}

export default useProperties;
