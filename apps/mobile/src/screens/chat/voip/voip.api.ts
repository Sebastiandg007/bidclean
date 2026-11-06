/**
 * voip.api — Typed HTTP access to the backend call endpoints (Spec 15).
 *
 * Uses the shared `apiClient` (lazy import to avoid circular deps), consistent with `chat.api`.
 * The `clientCallId` makes initiate idempotent (a retry returns the same RINGING call rather than
 * creating a second) and doubles as the `Idempotency-Key`. The room name and media token only ever
 * arrive on the token-bearing responses (initiate/answer/token); reads never carry a credential.
 */

import type { AxiosInstance } from 'axios';

import { VOIP_CALL_HISTORY_PAGE_SIZE, VOIP_ENDPOINTS } from './voip.constants';
import type { CallView, InitiatedCall, MediaKind, MediaToken } from './voip.types';

async function getApiClient(): Promise<AxiosInstance> {
  const { apiClient } = await import('../../../services/api.service');
  return apiClient;
}

/** Initiate a call; idempotent by `clientCallId` + `Idempotency-Key`. */
export async function initiateCallRequest(
  conversationId: string,
  clientCallId: string,
  mediaKind: MediaKind,
): Promise<InitiatedCall> {
  const client = await getApiClient();
  const response = await client.post<InitiatedCall>(
    VOIP_ENDPOINTS.calls(conversationId),
    { clientCallId, mediaKind },
    { headers: { 'Idempotency-Key': clientCallId } },
  );
  return response.data;
}

/** Answer a RINGING call as the callee; returns the callee's media token. */
export async function answerCallRequest(
  conversationId: string,
  callId: string,
): Promise<MediaToken> {
  const client = await getApiClient();
  const response = await client.post<MediaToken>(VOIP_ENDPOINTS.answer(conversationId, callId));
  return response.data;
}

/** Decline a RINGING call as the callee. */
export async function declineCallRequest(
  conversationId: string,
  callId: string,
): Promise<CallView> {
  const client = await getApiClient();
  const response = await client.post<CallView>(VOIP_ENDPOINTS.decline(conversationId, callId));
  return response.data;
}

/** Cancel a RINGING call as the initiator before it is answered. */
export async function cancelCallRequest(
  conversationId: string,
  callId: string,
): Promise<CallView> {
  const client = await getApiClient();
  const response = await client.post<CallView>(VOIP_ENDPOINTS.cancel(conversationId, callId));
  return response.data;
}

/** End an ONGOING (or RINGING) call. The server derives the authoritative terminal status. */
export async function endCallRequest(
  conversationId: string,
  callId: string,
): Promise<CallView> {
  const client = await getApiClient();
  const response = await client.post<CallView>(
    VOIP_ENDPOINTS.end(conversationId, callId),
    { endReason: 'HANGUP' },
  );
  return response.data;
}

/** Request a fresh media token for a still-ONGOING call (media reconnect / rejoin). */
export async function requestMediaTokenRequest(
  conversationId: string,
  callId: string,
): Promise<MediaToken> {
  const client = await getApiClient();
  const response = await client.post<MediaToken>(VOIP_ENDPOINTS.token(conversationId, callId));
  return response.data;
}

/** Read the authoritative call state (reconciliation, independent of signaling delivery). */
export async function getCallRequest(
  conversationId: string,
  callId: string,
): Promise<CallView> {
  const client = await getApiClient();
  const response = await client.get<CallView>(VOIP_ENDPOINTS.call(conversationId, callId));
  return response.data;
}

/** Read call history for a conversation (missed-call UX). */
export async function listCallsRequest(
  conversationId: string,
  before: string | null,
  limit: number = VOIP_CALL_HISTORY_PAGE_SIZE,
): Promise<CallView[]> {
  const client = await getApiClient();
  const params: Record<string, string | number> = { limit };
  if (before !== null) {
    params.before = before;
  }
  const response = await client.get<CallView[]>(VOIP_ENDPOINTS.calls(conversationId), { params });
  return response.data;
}
