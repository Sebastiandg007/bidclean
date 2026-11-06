/**
 * checklist.api — Typed HTTP access to the backend checklist-photos endpoints.
 *
 * Uses the shared `apiClient` (lazy import to avoid circular deps), consistent with `tracking.api`.
 * The photo upload flow is composed as ONE action: request-upload → PUT bytes directly to MinIO
 * (never through the API) → finalize. Playback URLs are fetched on demand by photo id.
 */

import type { AxiosInstance } from 'axios';

import { CHECKLIST_ENDPOINTS } from './checklist.constants';
import type {
  CapturedPhoto,
  ChecklistRun,
  PlaybackTarget,
  TaskPhotoKind,
  UploadTarget,
} from './checklist.types';

async function getApiClient(): Promise<AxiosInstance> {
  const { apiClient } = await import('../../services/api.service');
  return apiClient;
}

/** Fetch the authoritative run + tasks + photo refs (reconciliation). */
export async function getChecklistRequest(sessionId: string): Promise<ChecklistRun> {
  const client = await getApiClient();
  const response = await client.get<ChecklistRun>(CHECKLIST_ENDPOINTS.checklist(sessionId));
  return response.data;
}

/** Cleaner toggles a task done/undone. */
export async function markTaskRequest(
  sessionId: string,
  taskId: string,
  done: boolean,
): Promise<void> {
  const client = await getApiClient();
  await client.post(CHECKLIST_ENDPOINTS.markTask(sessionId, taskId), { done });
}

/** Cleaner finalizes the checklist (precondition-gated → COMPLETED). */
export async function finalizeChecklistRequest(sessionId: string): Promise<void> {
  const client = await getApiClient();
  await client.post(CHECKLIST_ENDPOINTS.finalize(sessionId));
}

/** Fetch a fresh participant-gated playback URL for a photo (Host or Cleaner). */
export async function getPlaybackUrlRequest(
  sessionId: string,
  photoId: string,
): Promise<PlaybackTarget> {
  const client = await getApiClient();
  const response = await client.get<PlaybackTarget>(
    CHECKLIST_ENDPOINTS.playbackUrl(sessionId, photoId),
  );
  return response.data;
}

/**
 * Compose the full evidence upload flow as one action: reserve a slot + grant (request-upload), PUT
 * the bytes directly to MinIO, then finalize (server re-inspects, authoritative). The API never
 * transports the bytes.
 */
export async function uploadTaskPhotoRequest(
  sessionId: string,
  taskId: string,
  photo: CapturedPhoto,
  kind: TaskPhotoKind,
): Promise<void> {
  const target = await requestUpload(sessionId, taskId);
  await putBytesToMinio(target, photo);
  await finalizePhoto(sessionId, taskId, target.objectKey, kind);
}

/** Step 1 — reserve a per-task slot + grant and mint a pre-signed PUT. */
async function requestUpload(sessionId: string, taskId: string): Promise<UploadTarget> {
  const client = await getApiClient();
  const response = await client.post<UploadTarget>(
    CHECKLIST_ENDPOINTS.requestUpload(sessionId, taskId),
  );
  return response.data;
}

/** Step 2 — PUT the captured bytes directly to MinIO (never through the API). */
async function putBytesToMinio(target: UploadTarget, photo: CapturedPhoto): Promise<void> {
  const blob = await fetch(photo.uri).then((res) => res.blob());
  await fetch(target.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': photo.mimeType },
    body: blob,
  });
}

/** Step 3 — finalize (server re-inspects size/type/dimensions; declared metadata advisory). */
async function finalizePhoto(
  sessionId: string,
  taskId: string,
  objectKey: string,
  kind: TaskPhotoKind,
): Promise<void> {
  const client = await getApiClient();
  await client.post(CHECKLIST_ENDPOINTS.finalizePhoto(sessionId, taskId), { objectKey, kind });
}
