/**
 * voice.api — Typed HTTP access for voice notes (Spec 14).
 *
 * Composes the three-step send as one action: (1) request a pre-signed upload URL + grant from the
 * backend, (2) PUT the recorded audio bytes DIRECTLY to MinIO (never through the API), (3) POST the
 * `type: 'VOICE'` chat message referencing the uploaded object. Also fetches a short-lived playback
 * URL on demand. The direct MinIO PUT uses the raw pre-signed URL (not the authenticated
 * `apiClient`), consistent with how other media uploads work.
 */

import type { AxiosInstance } from 'axios';

import { CHAT_ENDPOINTS, VOICE_RECORDING_MIME_TYPE } from './chat.constants';
import type {
  ChatSendResult,
  RecordedClip,
  VoicePlaybackTarget,
  VoiceUploadTarget,
} from './chat.types';

async function getApiClient(): Promise<AxiosInstance> {
  const { apiClient } = await import('../../services/api.service');
  return apiClient;
}

/** Request a pre-signed upload URL + grant for a voice note in a conversation. */
export async function requestUploadUrl(conversationId: string): Promise<VoiceUploadTarget> {
  const client = await getApiClient();
  const response = await client.post<VoiceUploadTarget>(
    CHAT_ENDPOINTS.voiceUploadUrl(conversationId),
  );
  return response.data;
}

/** PUT the recorded audio bytes directly to MinIO using the pre-signed URL. */
export async function uploadAudioToStorage(
  uploadUrl: string,
  clip: RecordedClip,
): Promise<void> {
  // Read the local file into a blob and PUT it to the pre-signed URL. `fetch` is used directly
  // (not apiClient) because the target is a time-boxed storage URL, not an API route.
  const fileResponse = await fetch(clip.uri);
  const blob = await fileResponse.blob();
  const putResponse = await fetch(uploadUrl, {
    method: 'PUT',
    body: blob,
    headers: { 'Content-Type': clip.mimeType || VOICE_RECORDING_MIME_TYPE },
  });
  if (!putResponse.ok) {
    throw new Error(`Voice upload failed with status ${putResponse.status}`);
  }
}

/** POST the durable VOICE chat message referencing the uploaded object. */
export async function sendVoiceMessageRequest(
  conversationId: string,
  clientMessageId: string,
  objectKey: string,
  clip: RecordedClip,
  waveform: number[] | null,
): Promise<ChatSendResult> {
  const client = await getApiClient();
  const response = await client.post<ChatSendResult>(
    CHAT_ENDPOINTS.messages(conversationId),
    {
      type: 'VOICE',
      clientMessageId,
      objectKey,
      durationMs: clip.durationMs,
      sizeBytes: clip.sizeBytes,
      mimeType: clip.mimeType,
      ...(waveform !== null ? { waveform } : {}),
    },
    { headers: { 'Idempotency-Key': clientMessageId } },
  );
  return response.data;
}

/**
 * The full send: request URL -> PUT to MinIO -> send message. Composed so the store can treat a
 * voice send as a single optimistic action (upload + message steps).
 */
export async function uploadAndSendVoiceNote(
  conversationId: string,
  clientMessageId: string,
  clip: RecordedClip,
  waveform: number[] | null,
): Promise<ChatSendResult> {
  const target = await requestUploadUrl(conversationId);
  await uploadAudioToStorage(target.uploadUrl, clip);
  return sendVoiceMessageRequest(
    conversationId,
    clientMessageId,
    target.objectKey,
    clip,
    waveform,
  );
}

/** Request a fresh short-lived playback URL for a voice note. */
export async function requestPlaybackUrl(
  conversationId: string,
  messageId: string,
): Promise<VoicePlaybackTarget> {
  const client = await getApiClient();
  const response = await client.get<VoicePlaybackTarget>(
    CHAT_ENDPOINTS.voicePlaybackUrl(conversationId, messageId),
  );
  return response.data;
}