/**
 * tracking.api — Typed HTTP access to the backend service-tracking + Centrifugo token endpoints.
 *
 * Uses the shared `apiClient` (lazy import to avoid circular deps), consistent with `chat.api` /
 * `voip.api`. Position samples are POSTed to the backend (Option A — the Cleaner never publishes to
 * the channel); the server evaluates and re-publishes to the Host.
 */

import type { AxiosInstance } from 'axios';

import { CENTRIFUGO_TOKEN_URL, TRACKING_ENDPOINTS } from './tracking.constants';
import type { LivePosition, ServiceSession } from './tracking.types';

async function getApiClient(): Promise<AxiosInstance> {
  const { apiClient } = await import('../../services/api.service');
  return apiClient;
}

/** Fetch the authoritative session state (reconciliation). */
export async function getSessionRequest(sessionId: string): Promise<ServiceSession> {
  const client = await getApiClient();
  const response = await client.get<ServiceSession>(TRACKING_ENDPOINTS.session(sessionId));
  return response.data;
}

/** Cleaner marks heading out (MATCHED → EN_ROUTE). */
export async function startEnRouteRequest(sessionId: string): Promise<ServiceSession> {
  const client = await getApiClient();
  const response = await client.post<ServiceSession>(TRACKING_ENDPOINTS.enRoute(sessionId));
  return response.data;
}

/** Cleaner reports a position sample (server evaluates the geofence then re-publishes). */
export async function postPositionRequest(
  sessionId: string,
  sample: Omit<LivePosition, 'heading'> & { heading?: number | null },
): Promise<ServiceSession> {
  const client = await getApiClient();
  const body: Record<string, number> = {
    lat: sample.lat,
    lng: sample.lng,
    accuracy: sample.accuracy,
    at: sample.at,
  };
  if (sample.heading !== null && sample.heading !== undefined) {
    body.heading = sample.heading;
  }
  const response = await client.post<ServiceSession>(TRACKING_ENDPOINTS.position(sessionId), body);
  return response.data;
}

/** Cleaner begins work (ARRIVED → IN_PROGRESS). */
export async function startRequest(sessionId: string): Promise<ServiceSession> {
  const client = await getApiClient();
  const response = await client.post<ServiceSession>(TRACKING_ENDPOINTS.start(sessionId));
  return response.data;
}

/** Explicit participant cancel (CANCELED_BY_PARTICIPANT). */
export async function cancelRequest(sessionId: string): Promise<ServiceSession> {
  const client = await getApiClient();
  const response = await client.post<ServiceSession>(TRACKING_ENDPOINTS.cancel(sessionId));
  return response.data;
}

/** Fetch a Centrifugo connection token for the authenticated user. */
export async function fetchConnectionTokenRequest(): Promise<string> {
  const client = await getApiClient();
  const response = await client.get<{ token: string }>(CENTRIFUGO_TOKEN_URL);
  return response.data.token;
}

/** Fetch a Centrifugo subscription token for a specific session channel (read-only Host). */
export async function fetchSessionChannelTokenRequest(channel: string): Promise<string> {
  const client = await getApiClient();
  const response = await client.get<{ token: string }>(CENTRIFUGO_TOKEN_URL, {
    params: { channel },
  });
  return response.data.token;
}
