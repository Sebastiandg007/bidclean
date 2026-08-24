/**
 * Zustand store for property management.
 *
 * Handles all property-related state and API calls:
 * - List with pagination, search, and type filter
 * - CRUD operations (create, read, update, delete)
 * - Photo management (upload, delete, reorder)
 * - Geocoding (forward and reverse)
 *
 * Each API mutation uses Idempotency-Key headers to prevent
 * duplicate operations on mobile retry/timeout scenarios.
 */

import type {
  Property,
  PropertyListItem,
  CreatePropertyPayload,
  UpdatePropertyPayload,
  GeocodeRequest,
  GeocodeResponse,
  ReverseGeocodeRequest,
  ReverseGeocodeResponse,
  ReorderPhotosPayload,
  PropertyListQuery,
} from './properties.types';

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
  fetchList: (query?: PropertyListQuery) => Promise<void>;
  fetchDetail: (propertyId: string) => Promise<void>;
  createProperty: (payload: CreatePropertyPayload) => Promise<Property | null>;
  updateProperty: (propertyId: string, payload: UpdatePropertyPayload) => Promise<void>;
  deleteProperty: (propertyId: string) => Promise<void>;
  uploadPhoto: (propertyId: string, imageUri: string) => Promise<void>;
  deletePhoto: (propertyId: string, photoId: string) => Promise<void>;
  reorderPhotos: (propertyId: string, payload: ReorderPhotosPayload) => Promise<void>;
  geocode: (request: GeocodeRequest) => Promise<GeocodeResponse | null>;
  reverseGeocode: (request: ReverseGeocodeRequest) => Promise<ReverseGeocodeResponse | null>;
  clearError: () => void;
  reset: () => void;
}

export type PropertiesStore = PropertiesState & PropertiesActions;

// TODO(Task-24): Implement Zustand store with API integration
// Placeholder export to prevent import errors
export const useProperties = (): PropertiesStore => {
  throw new Error('useProperties store not yet implemented. See Task 24.');
};

export default useProperties;
