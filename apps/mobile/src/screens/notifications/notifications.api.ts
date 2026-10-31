/**
 * notifications.api — typed HTTP access to the backend notifications endpoints.
 *
 * Uses the shared `apiClient` (lazy import to avoid circular deps), consistent with the other
 * feature API clients. The REST OneSignal key is server-side only; the client only ever sends its
 * player id + consent + preferences.
 */

import type { AxiosInstance } from 'axios';

import { NOTIFICATION_ENDPOINTS } from './notifications.constants';
import type {
  NotificationPreferences,
  RegisterDeviceRequest,
} from './notifications.types';

async function getApiClient(): Promise<AxiosInstance> {
  const { apiClient } = await import('../../services/api.service');
  return apiClient;
}

/** Register/upsert the caller's device in the backend registry. */
export async function registerDeviceRequest(body: RegisterDeviceRequest): Promise<void> {
  const client = await getApiClient();
  await client.post(NOTIFICATION_ENDPOINTS.DEVICES, body);
}

/** Update the caller's device consent. */
export async function updateConsentRequest(
  playerId: string,
  consentGranted: boolean,
): Promise<void> {
  const client = await getApiClient();
  await client.patch(NOTIFICATION_ENDPOINTS.deviceConsent(playerId), { consentGranted });
}

/** Unregister (logout) the caller's device. */
export async function unregisterDeviceRequest(playerId: string): Promise<void> {
  const client = await getApiClient();
  await client.delete(NOTIFICATION_ENDPOINTS.device(playerId));
}

/** Read the caller's notification preferences. */
export async function getPreferencesRequest(): Promise<NotificationPreferences> {
  const client = await getApiClient();
  const response = await client.get<NotificationPreferences>(NOTIFICATION_ENDPOINTS.PREFERENCES);
  return response.data;
}

/** Update the caller's notification preferences. */
export async function updatePreferencesRequest(
  preferences: NotificationPreferences,
): Promise<void> {
  const client = await getApiClient();
  await client.put(NOTIFICATION_ENDPOINTS.PREFERENCES, preferences);
}
