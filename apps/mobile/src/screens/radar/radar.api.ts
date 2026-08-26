/**
 * Radar API — HTTP client interface for the Offer Radar endpoints.
 *
 * Provides typed methods for:
 * - GET /offers/available (paginated, filtered, sorted)
 * - GET /offers/available/snapshot (full reconciliation set)
 *
 * Uses the shared apiClient with automatic auth token injection.
 */

import type {
  RadarFilters,
  SortOption,
  AvailableOffersResponse,
  AvailableOffersSnapshotResponse,
} from './radar.types';

// ─── Endpoints ───────────────────────────────────────────────────────────────

const ENDPOINTS = {
  AVAILABLE: '/offers/available',
  SNAPSHOT: '/offers/available/snapshot',
} as const;

// ─── Request Params ──────────────────────────────────────────────────────────

export interface FetchAvailableOffersParams {
  filters: RadarFilters;
  sort: SortOption;
  page: number;
  limit: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getApiClient() {
  const { apiClient } = await import('../../services/api.service');
  return apiClient;
}

function buildQueryParams(params: FetchAvailableOffersParams): Record<string, string | number> {
  const query: Record<string, string | number> = {
    sort: params.sort,
    page: params.page,
    limit: params.limit,
  };

  const { filters } = params;

  if (filters.serviceTypes.length > 0) {
    query.serviceType = filters.serviceTypes.join(',');
  }
  if (filters.minPriceCents !== null) {
    query.minPriceCents = filters.minPriceCents;
  }
  if (filters.maxPriceCents !== null) {
    query.maxPriceCents = filters.maxPriceCents;
  }
  if (filters.maxDistanceMeters !== null) {
    query.maxDistanceMeters = filters.maxDistanceMeters;
  }
  if (filters.scheduledAfter !== null) {
    query.scheduledAfter = filters.scheduledAfter;
  }
  if (filters.scheduledBefore !== null) {
    query.scheduledBefore = filters.scheduledBefore;
  }

  return query;
}

// ─── API Methods ─────────────────────────────────────────────────────────────

/**
 * Fetches paginated available offers with server-side filters and sort.
 * Used for initial load, filter changes, and pagination.
 */
export async function fetchAvailableOffers(
  params: FetchAvailableOffersParams,
): Promise<AvailableOffersResponse> {
  const client = await getApiClient();
  const queryParams = buildQueryParams(params);

  const response = await client.get<AvailableOffersResponse>(ENDPOINTS.AVAILABLE, {
    params: queryParams,
  });

  return response.data;
}

/**
 * Fetches the full unpaginated snapshot for reconciliation.
 * Rate limited: max 1 request per 30 seconds per Cleaner.
 * Used exclusively after WebSocket reconnection.
 */
export async function fetchSnapshot(): Promise<AvailableOffersSnapshotResponse> {
  const client = await getApiClient();

  const response = await client.get<AvailableOffersSnapshotResponse>(ENDPOINTS.SNAPSHOT);

  return response.data;
}
