/**
 * favorites.api — Typed HTTP access to the backend favorites endpoints (Spec 22).
 *
 * Uses the shared `apiClient` (lazy import to avoid circular deps), consistent with the sibling
 * domain clients. `add` maps the backend status to an `AddResult`: `201 → CREATED`, `204 →
 * ALREADY_EXISTS`, `422 → OVER_LIMIT` (surfaced so the store can show the limit banner and revert
 * the optimistic toggle). Membership authority stays server-side; the client is convenience only.
 */

import type { AxiosInstance } from 'axios';

import { FAVORITES_ENDPOINTS } from './favorites.constants';
import type { AddResult, FavoritesPage } from './favorites.types';

/** HTTP status the backend returns when a genuinely new add is rejected at the tier cap. */
const OVER_LIMIT_STATUS = 422;

async function getApiClient(): Promise<AxiosInstance> {
  const { apiClient } = await import('../../services/api.service');
  return apiClient;
}

/**
 * Add a favorite. Resolves to the mapped `AddResult`. `validateStatus` treats `422` as a
 * non-throwing response so the store can distinguish OVER_LIMIT from a network/other error.
 */
export async function addFavoriteRequest(cleanerId: string): Promise<AddResult> {
  const client = await getApiClient();
  const response = await client.post(
    FAVORITES_ENDPOINTS.base,
    { cleanerId },
    { validateStatus: (status) => (status >= 200 && status < 300) || status === OVER_LIMIT_STATUS },
  );
  if (response.status === OVER_LIMIT_STATUS) {
    return 'OVER_LIMIT';
  }
  return response.status === 201 ? 'CREATED' : 'ALREADY_EXISTS';
}

/** Remove a favorite (idempotent; always 204 on the backend). */
export async function removeFavoriteRequest(cleanerId: string): Promise<void> {
  const client = await getApiClient();
  await client.delete(FAVORITES_ENDPOINTS.favorite(cleanerId));
}

/** Fetch one keyset page of the Host's favorites. */
export async function listFavoritesRequest(
  limit?: number,
  cursor?: string | null,
): Promise<FavoritesPage> {
  const client = await getApiClient();
  const params: Record<string, string | number> = {};
  if (limit !== undefined) {
    params.limit = limit;
  }
  if (cursor !== undefined && cursor !== null) {
    params.cursor = cursor;
  }
  const response = await client.get<FavoritesPage>(FAVORITES_ENDPOINTS.base, { params });
  return response.data;
}

/** Check whether a single (host, cleaner) pair is favorited (toggle state). */
export async function isFavoriteRequest(cleanerId: string): Promise<boolean> {
  const client = await getApiClient();
  const response = await client.get<{ isFavorite: boolean }>(
    FAVORITES_ENDPOINTS.isFavorite(cleanerId),
  );
  return response.data.isFavorite;
}

/** Cleaner-facing aggregate count (opt-in on the backend); returns a number only. */
export async function aggregateCountRequest(): Promise<number> {
  const client = await getApiClient();
  const response = await client.get<{ count: number }>(FAVORITES_ENDPOINTS.aggregateCount);
  return response.data.count;
}
