/**
 * Subscriptions API client.
 *
 * Typed HTTP access to the server-authoritative subscription view. Uses the shared apiClient
 * (lazy import to avoid circular deps), consistent with the other feature API clients.
 */

import type { AxiosInstance } from 'axios';

import { SUBSCRIPTIONS_ENDPOINTS } from './subscriptions.constants';
import type { SubscriptionView } from './subscriptions.types';

async function getApiClient(): Promise<AxiosInstance> {
  const { apiClient } = await import('../../services/api.service');
  return apiClient;
}

/** Fetch the caller's authoritative entitlements + tier from the backend mirror. */
export async function fetchMyEntitlementsRequest(): Promise<SubscriptionView> {
  const client = await getApiClient();
  const response = await client.get<SubscriptionView>(SUBSCRIPTIONS_ENDPOINTS.ME);
  return response.data;
}
