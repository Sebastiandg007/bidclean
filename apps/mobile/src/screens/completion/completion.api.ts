/**
 * completion.api — Typed HTTP access to the backend service-completion endpoints.
 *
 * Uses the shared `apiClient` (lazy import to avoid circular deps), consistent with `tracking.api` /
 * `checklist.api`. `release` is NOT an action here — it is driven server-side by the release-intent
 * worker; the client only confirms/disputes/rates and reconciles via `GET`.
 */

import type { AxiosInstance } from 'axios';

import { COMPLETION_ENDPOINTS } from './completion.constants';
import type { ServiceCompletion, ServiceRating } from './completion.types';

async function getApiClient(): Promise<AxiosInstance> {
  const { apiClient } = await import('../../services/api.service');
  return apiClient;
}

/** Fetch the authoritative completion (state + deadline + rating status + releaseStatus). */
export async function getCompletionRequest(id: string): Promise<ServiceCompletion> {
  const client = await getApiClient();
  const response = await client.get<ServiceCompletion>(COMPLETION_ENDPOINTS.completion(id));
  return response.data;
}

/** Host confirms satisfaction (→ CONFIRMED; triggers the durable release intent server-side). */
export async function confirmCompletionRequest(id: string): Promise<void> {
  const client = await getApiClient();
  await client.post(COMPLETION_ENDPOINTS.confirm(id));
}

/** Host opens a pre-release dispute (→ DISPUTED; suppresses auto-release). */
export async function disputeCompletionRequest(id: string): Promise<void> {
  const client = await getApiClient();
  await client.post(COMPLETION_ENDPOINTS.dispute(id));
}

/** Host opens a post-release dispute (only accepted once the release is ACCEPTED). */
export async function postReleaseDisputeRequest(id: string): Promise<void> {
  const client = await getApiClient();
  await client.post(COMPLETION_ENDPOINTS.postReleaseDispute(id));
}

/** Submit one rating side (never gating). */
export async function submitRatingRequest(
  id: string,
  stars: number,
  comment?: string,
): Promise<void> {
  const client = await getApiClient();
  const body: Record<string, unknown> = { stars };
  if (comment !== undefined && comment.length > 0) {
    body.comment = comment;
  }
  await client.post(COMPLETION_ENDPOINTS.ratings(id), body);
}

/** Fetch the participant-gated ratings for a completion. */
export async function getRatingsRequest(id: string): Promise<ServiceRating[]> {
  const client = await getApiClient();
  const response = await client.get<ServiceRating[]>(COMPLETION_ENDPOINTS.ratings(id));
  return response.data;
}
