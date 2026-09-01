/**
 * chat.api — Typed HTTP access to the backend chat + Centrifugo token endpoints.
 *
 * Uses the shared `apiClient` (lazy import to avoid circular deps), consistent with the other
 * feature API clients. Sends carry an `Idempotency-Key` header (required by the backend) plus the
 * `clientMessageId` in the body for idempotent retry / optimistic reconciliation.
 */

import type { AxiosInstance } from 'axios';

import {
  CENTRIFUGO_TOKEN_URL,
  CHAT_ENDPOINTS,
  CHAT_HISTORY_PAGE_SIZE,
} from './chat.constants';
import type {
  ChatConversation,
  ChatConversationSummary,
  ChatMessagePage,
  ChatSendResult,
} from './chat.types';

async function getApiClient(): Promise<AxiosInstance> {
  const { apiClient } = await import('../../services/api.service');
  return apiClient;
}

/** Open (or fetch) the conversation for a matched thread. */
export async function openConversationRequest(
  threadId: string,
): Promise<ChatConversation> {
  const client = await getApiClient();
  const response = await client.post<ChatConversation>(
    CHAT_ENDPOINTS.openForThread(threadId),
  );
  return response.data;
}

/** List the caller's conversations (inbox). */
export async function listConversationsRequest(): Promise<ChatConversationSummary[]> {
  const client = await getApiClient();
  const response = await client.get<ChatConversationSummary[]>(
    CHAT_ENDPOINTS.CONVERSATIONS,
  );
  return response.data;
}

/** Fetch a single conversation. */
export async function getConversationRequest(
  conversationId: string,
): Promise<ChatConversation> {
  const client = await getApiClient();
  const response = await client.get<ChatConversation>(
    CHAT_ENDPOINTS.conversation(conversationId),
  );
  return response.data;
}

/** Fetch older messages before a sequence (backward scroll); omit `beforeSeq` for the latest page. */
export async function getMessagesBeforeRequest(
  conversationId: string,
  beforeSeq: number | null,
  limit: number = CHAT_HISTORY_PAGE_SIZE,
): Promise<ChatMessagePage> {
  const client = await getApiClient();
  const params: Record<string, number> = { limit };
  if (beforeSeq !== null) {
    params.before = beforeSeq;
  }
  const response = await client.get<ChatMessagePage>(
    CHAT_ENDPOINTS.messages(conversationId),
    { params },
  );
  return response.data;
}

/** Fetch messages newer than a sequence (reconnect reconciliation). */
export async function getMessagesAfterRequest(
  conversationId: string,
  afterSeq: number,
  limit: number = CHAT_HISTORY_PAGE_SIZE,
): Promise<ChatMessagePage> {
  const client = await getApiClient();
  const response = await client.get<ChatMessagePage>(
    CHAT_ENDPOINTS.messages(conversationId),
    { params: { after: afterSeq, limit } },
  );
  return response.data;
}

/** Send a message; idempotent by `clientMessageId` + `Idempotency-Key`. */
export async function sendMessageRequest(
  conversationId: string,
  clientMessageId: string,
  body: string,
): Promise<ChatSendResult> {
  const client = await getApiClient();
  const response = await client.post<ChatSendResult>(
    CHAT_ENDPOINTS.messages(conversationId),
    { clientMessageId, body },
    { headers: { 'Idempotency-Key': clientMessageId } },
  );
  return response.data;
}

/** Fetch a Centrifugo connection token for the authenticated user. */
export async function fetchConnectionTokenRequest(): Promise<string> {
  const client = await getApiClient();
  const response = await client.get<{ token: string }>(CENTRIFUGO_TOKEN_URL);
  return response.data.token;
}

/** Fetch a Centrifugo subscription token for a specific conversation channel. */
export async function fetchSubscriptionTokenRequest(channel: string): Promise<string> {
  const client = await getApiClient();
  const response = await client.get<{ token: string }>(CENTRIFUGO_TOKEN_URL, {
    params: { channel },
  });
  return response.data.token;
}
