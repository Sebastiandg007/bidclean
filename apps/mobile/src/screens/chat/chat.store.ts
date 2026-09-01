/**
 * chat.store — Zustand store for realtime chat (one store per domain).
 *
 * Holds conversations (inbox) and per-conversation message lists, plus a single connection status.
 * Messages are the client's local view of the server-authoritative log: ordered by `sequenceNumber`
 * and de-duplicated by `id` (server) and `clientMessageId` (own optimistic sends). Sends are
 * optimistic — a `sending` placeholder is inserted immediately, reconciled to the server message on
 * success, and flipped to `failed` on error or after a bounded timeout. Incoming realtime messages
 * and history pages (before/after) are upserted through the same idempotent merge, so the same
 * message rendered from a live push, a fetch, and an optimistic echo appears exactly once (P13).
 *
 * The store never talks to the network directly beyond the typed `chat.api` calls; it owns no
 * transport/reconnect logic (that lives in `useChatChannel`). Errors surface as i18n key strings.
 */

import { create } from 'zustand';
import * as Crypto from 'expo-crypto';

import {
  getMessagesAfterRequest,
  getMessagesBeforeRequest,
  listConversationsRequest,
  openConversationRequest,
  sendMessageRequest,
} from './chat.api';
import { CHAT_I18N_KEYS, CHAT_SEND_TIMEOUT_MS } from './chat.constants';
import type {
  ChatConversation,
  ChatConversationSummary,
  ChatMessage,
  ConnectionStatus,
} from './chat.types';

const CLIENT_MESSAGE_ID_BYTES = 16;

/** Generate a cryptographically random client message id (also used as the Idempotency-Key). */
async function generateClientMessageId(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(CLIENT_MESSAGE_ID_BYTES);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Store Interface ─────────────────────────────────────────────────────────

export interface ChatState {
  /** Inbox: conversation id → summary (last-message preview). */
  conversations: Map<string, ChatConversationSummary>;
  /** Per-conversation message lists, each kept sorted by `sequenceNumber` asc. */
  messagesByConversation: Map<string, ChatMessage[]>;
  /** Single WebSocket connection status surfaced to the UI. */
  connectionStatus: ConnectionStatus;
  /** True while the inbox is loading. */
  isLoadingConversations: boolean;
  /** Conversation id → true while an older-history page is loading. */
  isLoadingOlder: Map<string, boolean>;
  /** Conversation id → whether more history exists before the earliest held message. */
  hasMoreOlder: Map<string, boolean>;
  /** Last error as an i18n key (cleared on next successful action). */
  error: string | null;
}

export interface ChatActions {
  /** Load the inbox (list of conversations). */
  loadConversations: () => Promise<void>;
  /**
   * Open (or fetch) the conversation for a matched thread and load its latest history page.
   * Returns the conversation so callers (navigation) can route by id.
   */
  openConversation: (threadId: string) => Promise<ChatConversation | null>;
  /** Load the latest history page for an already-known conversation. */
  loadConversationMessages: (conversationId: string) => Promise<void>;
  /** Load an older page (keyset `before` the earliest held message). */
  loadOlder: (conversationId: string) => Promise<void>;
  /** Reconcile newer messages (keyset `after` the latest held server sequence). */
  reconcileNewer: (conversationId: string) => Promise<void>;
  /** Optimistically send a message; reconciles on success, flips to `failed` on timeout/error. */
  sendMessage: (conversationId: string, body: string) => Promise<void>;
  /** Upsert a message arriving over the realtime channel (idempotent). */
  onIncomingMessage: (message: ChatMessage) => void;
  /** Set the connection status (driven by the realtime hook). */
  setConnectionStatus: (status: ConnectionStatus) => void;
  /** Read the messages for a conversation (empty array when unknown). */
  getMessages: (conversationId: string) => ChatMessage[];
  /** Clear the last error. */
  clearError: () => void;
  /** Reset to the initial state. */
  reset: () => void;
}

export type ChatStore = ChatState & ChatActions;

// ─── Initial State ───────────────────────────────────────────────────────────

const initialState: ChatState = {
  conversations: new Map(),
  messagesByConversation: new Map(),
  connectionStatus: 'disconnected',
  isLoadingConversations: false,
  isLoadingOlder: new Map(),
  hasMoreOlder: new Map(),
  error: null,
};

// ─── Merge Helpers (pure) ──────────────────────────────────────────────────────

/**
 * Merge incoming messages into an existing list, idempotently.
 *
 * De-duplication key: a message matches an existing one when server `id`s are equal, OR when both
 * carry the same `clientMessageId` (an optimistic echo of a locally-sent message). The incoming
 * server-confirmed message replaces the local optimistic placeholder. The result is sorted by
 * `sequenceNumber` ascending. Processing the same message any number of times yields one entry.
 */
function mergeMessages(
  existing: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  const idByClientMessageId = new Map<string, string>();

  const upsert = (message: ChatMessage): void => {
    const priorId = idByClientMessageId.get(message.clientMessageId);
    if (priorId !== undefined && priorId !== message.id) {
      byId.delete(priorId);
    }
    byId.set(message.id, message);
    idByClientMessageId.set(message.clientMessageId, message.id);
  };

  for (const message of existing) {
    upsert(message);
  }
  for (const message of incoming) {
    upsert(message);
  }

  return Array.from(byId.values()).sort((a, b) => a.sequenceNumber - b.sequenceNumber);
}

/** Highest server-assigned sequence number currently held (0 when none). */
function latestSequence(messages: readonly ChatMessage[]): number {
  let max = 0;
  for (const message of messages) {
    if (message.sendState === undefined && message.sequenceNumber > max) {
      max = message.sequenceNumber;
    }
  }
  return max;
}

/** Earliest server-assigned sequence number currently held (null when none). */
function earliestSequence(messages: readonly ChatMessage[]): number | null {
  let min: number | null = null;
  for (const message of messages) {
    if (message.sendState === undefined && (min === null || message.sequenceNumber < min)) {
      min = message.sequenceNumber;
    }
  }
  return min;
}

/** Build an optimistic placeholder for a not-yet-confirmed send. */
function buildOptimisticMessage(
  conversationId: string,
  clientMessageId: string,
  body: string,
): ChatMessage {
  return {
    id: `local:${clientMessageId}`,
    conversationId,
    senderId: null,
    type: 'TEXT',
    body,
    // Sort optimistic sends after every server message until reconciled.
    sequenceNumber: Number.MAX_SAFE_INTEGER,
    clientMessageId,
    createdAt: new Date().toISOString(),
    sendState: 'sending',
  };
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useChatStore = create<ChatStore>((set, get) => ({
  ...initialState,

  // ─── Inbox ────────────────────────────────────────────────────────────────

  loadConversations: async () => {
    set({ isLoadingConversations: true, error: null });
    try {
      const summaries = await listConversationsRequest();
      const conversations = new Map<string, ChatConversationSummary>();
      for (const summary of summaries) {
        conversations.set(summary.id, summary);
      }
      set({ conversations, isLoadingConversations: false, error: null });
    } catch {
      set({ isLoadingConversations: false, error: CHAT_I18N_KEYS.LOAD_ERROR });
    }
  },

  openConversation: async (threadId) => {
    set({ error: null });
    try {
      const conversation = await openConversationRequest(threadId);
      const { conversations } = get();
      const merged = new Map(conversations);
      const existing = merged.get(conversation.id);
      merged.set(conversation.id, {
        ...conversation,
        lastMessagePreview: existing?.lastMessagePreview ?? null,
      });
      set({ conversations: merged });
      await get().loadConversationMessages(conversation.id);
      return conversation;
    } catch {
      set({ error: CHAT_I18N_KEYS.LOAD_ERROR });
      return null;
    }
  },

  loadConversationMessages: async (conversationId) => {
    set({ error: null });
    try {
      const page = await getMessagesBeforeRequest(conversationId, null);
      const { messagesByConversation, hasMoreOlder } = get();
      const merged = new Map(messagesByConversation);
      merged.set(
        conversationId,
        mergeMessages(merged.get(conversationId) ?? [], page.messages),
      );
      const more = new Map(hasMoreOlder);
      more.set(conversationId, page.hasMore);
      set({ messagesByConversation: merged, hasMoreOlder: more });
    } catch {
      set({ error: CHAT_I18N_KEYS.LOAD_ERROR });
    }
  },

  // ─── History paging ─────────────────────────────────────────────────────────

  loadOlder: async (conversationId) => {
    const { messagesByConversation, hasMoreOlder, isLoadingOlder } = get();
    if (isLoadingOlder.get(conversationId) === true) {
      return;
    }
    if (hasMoreOlder.get(conversationId) === false) {
      return;
    }

    const current = messagesByConversation.get(conversationId) ?? [];
    const before = earliestSequence(current);

    const loading = new Map(isLoadingOlder);
    loading.set(conversationId, true);
    set({ isLoadingOlder: loading, error: null });

    try {
      const page = await getMessagesBeforeRequest(conversationId, before);
      const merged = new Map(get().messagesByConversation);
      merged.set(conversationId, mergeMessages(current, page.messages));
      const more = new Map(get().hasMoreOlder);
      more.set(conversationId, page.hasMore);
      const doneLoading = new Map(get().isLoadingOlder);
      doneLoading.set(conversationId, false);
      set({ messagesByConversation: merged, hasMoreOlder: more, isLoadingOlder: doneLoading });
    } catch {
      const doneLoading = new Map(get().isLoadingOlder);
      doneLoading.set(conversationId, false);
      set({ isLoadingOlder: doneLoading, error: CHAT_I18N_KEYS.LOAD_ERROR });
    }
  },

  reconcileNewer: async (conversationId) => {
    const current = get().messagesByConversation.get(conversationId) ?? [];
    const after = latestSequence(current);

    try {
      const page = await getMessagesAfterRequest(conversationId, after);
      const merged = new Map(get().messagesByConversation);
      merged.set(conversationId, mergeMessages(current, page.messages));
      set({ messagesByConversation: merged });
    } catch {
      // Reconciliation is best-effort; keep existing state (recovered on the next attempt).
    }
  },

  // ─── Sending (optimistic) ────────────────────────────────────────────────────

  sendMessage: async (conversationId, body) => {
    const clientMessageId = await generateClientMessageId();
    const current = get().messagesByConversation.get(conversationId) ?? [];
    const optimistic = buildOptimisticMessage(conversationId, clientMessageId, body);

    const withOptimistic = new Map(get().messagesByConversation);
    withOptimistic.set(conversationId, mergeMessages(current, [optimistic]));
    set({ messagesByConversation: withOptimistic });

    const markFailed = (): void => {
      const list = get().messagesByConversation.get(conversationId) ?? [];
      const next = list.map((m) =>
        m.clientMessageId === clientMessageId && m.sendState !== undefined
          ? { ...m, sendState: 'failed' as const }
          : m,
      );
      const map = new Map(get().messagesByConversation);
      map.set(conversationId, next);
      set({ messagesByConversation: map });
    };

    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      markFailed();
    }, CHAT_SEND_TIMEOUT_MS);

    try {
      const result = await sendMessageRequest(conversationId, clientMessageId, body);
      clearTimeout(timeout);
      // Reconcile the confirmed message; dedup replaces the optimistic placeholder by
      // clientMessageId even if the timeout already fired (the failed placeholder is overwritten).
      get().onIncomingMessage(result.message);
      settled = true;
    } catch {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        markFailed();
      }
    }
  },

  // ─── Realtime intake ──────────────────────────────────────────────────────────

  onIncomingMessage: (message) => {
    const { messagesByConversation, conversations } = get();
    const current = messagesByConversation.get(message.conversationId) ?? [];

    const merged = new Map(messagesByConversation);
    merged.set(message.conversationId, mergeMessages(current, [message]));

    const patch: Partial<ChatState> = { messagesByConversation: merged };

    // Refresh the inbox preview when we already track this conversation's summary. A message alone
    // can't produce a complete ChatConversationSummary (it lacks thread/offer/participant fields),
    // so a conversation not yet in the inbox is left to the authoritative `loadConversations`
    // refresh rather than fabricating a partial summary.
    const summary = conversations.get(message.conversationId);
    if (summary !== undefined) {
      const nextConversations = new Map(conversations);
      nextConversations.set(message.conversationId, {
        ...summary,
        lastMessagePreview: message.body,
        lastMessageAt: message.createdAt,
      });
      patch.conversations = nextConversations;
    }

    set(patch);
  },

  setConnectionStatus: (status) => {
    set({ connectionStatus: status });
  },

  // ─── Selectors & housekeeping ──────────────────────────────────────────────────

  getMessages: (conversationId) => {
    return get().messagesByConversation.get(conversationId) ?? [];
  },

  clearError: () => {
    set({ error: null });
  },

  reset: () => {
    set({
      conversations: new Map(),
      messagesByConversation: new Map(),
      connectionStatus: 'disconnected',
      isLoadingConversations: false,
      isLoadingOlder: new Map(),
      hasMoreOlder: new Map(),
      error: null,
    });
  },
}));

// ─── Hook ──────────────────────────────────────────────────────────────────────

/** Convenience hook returning the full chat store. */
export function useChat(): ChatStore {
  return useChatStore();
}

export default useChat;
