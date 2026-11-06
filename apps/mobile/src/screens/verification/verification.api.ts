/**
 * verification.api — Typed HTTP access to the backend video-verification endpoints.
 *
 * Uses the shared `apiClient` (lazy import to avoid circular deps), consistent with `tracking.api` /
 * `chat.api`. The upload is composed as ONE action: request-upload (grant + pre-signed PUT) → PUT the
 * bytes DIRECTLY to MinIO (the API never transports the bytes) → finalize (server re-inspects and
 * transitions). There is no playback endpoint — the client never fetches the footage.
 */

import type { AxiosInstance } from 'axios';

import { VERIFICATION_ENDPOINTS } from './verification.constants';
import type { RecordedClip, UploadTarget, VerificationView } from './verification.types';

async function getApiClient(): Promise<AxiosInstance> {
  const { apiClient } = await import('../../services/api.service');
  return apiClient;
}

/** Fetch the authoritative verification state (reconciliation). */
export async function getVerificationRequest(id: string): Promise<VerificationView> {
  const client = await getApiClient();
  const response = await client.get<VerificationView>(VERIFICATION_ENDPOINTS.get(id));
  return response.data;
}

/** Cleaner requests an upload target (grant persisted server-side first, then a pre-signed PUT). */
export async function requestUploadRequest(id: string): Promise<UploadTarget> {
  const client = await getApiClient();
  const response = await client.post<UploadTarget>(VERIFICATION_ENDPOINTS.requestUpload(id));
  return response.data;
}

/** Finalize the upload; the server re-inspects the object (declared metadata is advisory). */
export async function finalizeUploadRequest(
  id: string,
  clip: RecordedClip,
  objectKey: string,
): Promise<VerificationView> {
  const client = await getApiClient();
  const response = await client.post<VerificationView>(VERIFICATION_ENDPOINTS.finalize(id), {
    objectKey,
    durationMs: clip.durationMs,
    sizeBytes: clip.sizeBytes,
    mimeType: clip.mimeType,
  });
  return response.data;
}

/** PUT the recorded clip bytes DIRECTLY to the pre-signed MinIO URL (bytes never touch the API). */
export async function putClipToStorage(uploadUrl: string, clip: RecordedClip): Promise<void> {
  const response = await fetch(clip.uri);
  const blob = await response.blob();
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': clip.mimeType },
    body: blob,
  });
  if (!put.ok) {
    throw new Error(`Upload PUT failed with status ${put.status}`);
  }
}

/** Compose the full upload: request-upload → PUT to MinIO → finalize. Returns the updated view. */
export async function uploadArrivalClip(
  id: string,
  clip: RecordedClip,
): Promise<VerificationView> {
  const target = await requestUploadRequest(id);
  await putClipToStorage(target.uploadUrl, clip);
  return finalizeUploadRequest(id, clip, target.objectKey);
}
