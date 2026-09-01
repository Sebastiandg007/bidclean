/**
 * useChatChannel — WebSocket hook for realtime delivery of chat messages on a single conversation.
 *
 * Mirrors the radar's `useCentrifugoChannel` lifecycle (raw WebSocket, no `centrifuge-js`):
 * - fetches a connection token + a per-channel subscription token from the auth-owned endpoint
 * - connects to `chat:conversation:{id}` and unwraps the Centrifugo push envelope
 *   (`data.result.data` or `data.push.pub.data`)
 * - reconnects with bounded exponential backoff (1s → 2s → … → 30s)
 * - on (re)connect, reconciles missed messages via the store's `after` cursor (P19), so recovery
 *   never depends on immediate realtime delivery
 * - subscribes on mount, tears down on unmount; no duplicate subscriptions
 *
 * Transport only: message merge/dedup/order live in the store. The hook never persists or dedups.
 *
 * @requirements 5.1, 5.2, 5.3, 5.4, 5.6, 2.7 · P13, P14, P15, P19
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchConnectionTokenRequest,
  fetchSubscriptionTokenRequest,
} from './chat.api';
import {
  CENTRIFUGO_WS_URL,
  WS_INITIAL_BACKOFF_MS,
  WS_MAX_BACKOFF_MS,
  chatChannelForConversation,
} from './chat.constants';
import type { ChatMessage, ConnectionStatus } from './chat.types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UseChatChannelOptions {
  /** The conversation whose channel to subscribe to. */
  conversationId: string;
  /** Called with each message parsed from the realtime channel (store upserts/dedups it). */
  onMessage: (message: ChatMessage) => void;
  /** Called on every connection status transition. */
  onConnectionChange: (status: ConnectionStatus) => void;
  /** Called on (re)connect so the caller can reconcile via the `after` cursor. */
  onReconcile: (conversationId: string) => void;
}

export interface UseChatChannelReturn {
  /** Whether the WebSocket is currently connected. */
  isConnected: boolean;
  /** Manually tear down the connection (used by cleanup / navigation away). */
  disconnect: () => void;
}

// ─── Helpers (pure) ────────────────────────────────────────────────────────────

/** Exponential backoff capped at the max (1s, 2s, 4s, …, 30s). */
function calculateBackoffDelay(attempt: number): number {
  const delay = WS_INITIAL_BACKOFF_MS * Math.pow(2, attempt);
  return Math.min(delay, WS_MAX_BACKOFF_MS);
}

/** Validate + narrow a raw payload into a ChatMessage; null when malformed. */
function parseChatMessage(data: unknown): ChatMessage | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const record = data as Record<string, unknown>;
  const candidate = record.type === 'chat_message' ? record.message : record;
  if (typeof candidate !== 'object' || candidate === null) {
    return null;
  }
  const message = candidate as Record<string, unknown>;
  if (
    typeof message.id !== 'string' ||
    typeof message.conversationId !== 'string' ||
    typeof message.body !== 'string' ||
    typeof message.sequenceNumber !== 'number' ||
    typeof message.clientMessageId !== 'string' ||
    typeof message.createdAt !== 'string'
  ) {
    return null;
  }
  return message as unknown as ChatMessage;
}

/** Unwrap the Centrifugo push envelope (matches the radar hook's handling). */
function unwrapEnvelope(raw: unknown): unknown {
  const data = raw as { result?: { channel?: unknown; data?: unknown }; push?: { pub?: { data?: unknown } } };
  if (data?.result?.channel !== undefined) {
    return data.result.data;
  }
  return data?.push?.pub?.data ?? raw;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Manage a WebSocket subscription to a conversation's Centrifugo channel, dispatching parsed
 * messages to the caller and triggering reconciliation on every (re)connect.
 */
export function useChatChannel(options: UseChatChannelOptions): UseChatChannelReturn {
  const { conversationId, onMessage, onConnectionChange, onReconcile } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const isDisconnectingRef = useRef<boolean>(false);
  const hasConnectedOnceRef = useRef<boolean>(false);

  const onMessageRef = useRef(onMessage);
  const onConnectionChangeRef = useRef(onConnectionChange);
  const onReconcileRef = useRef(onReconcile);

  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    onMessageRef.current = onMessage;
    onConnectionChangeRef.current = onConnectionChange;
    onReconcileRef.current = onReconcile;
  });

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const handleRawMessage = useCallback((rawData: string) => {
    try {
      const parsed = JSON.parse(rawData);
      const payload = unwrapEnvelope(parsed);
      const message = parseChatMessage(payload);
      if (message !== null) {
        onMessageRef.current(message);
      }
    } catch {
      // Malformed frame — ignore (defensive, no user impact).
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (isDisconnectingRef.current) {
      return;
    }
    const attempt = reconnectAttemptsRef.current;
    const delay = calculateBackoffDelay(attempt);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectAttemptsRef.current = attempt + 1;
      connect(); // eslint-disable-line @typescript-eslint/no-use-before-define
    }, delay);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = useCallback(async () => {
    if (isDisconnectingRef.current) {
      return;
    }

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const channel = chatChannelForConversation(conversationId);
      const [connectionToken, subscriptionToken] = await Promise.all([
        fetchConnectionTokenRequest(),
        fetchSubscriptionTokenRequest(channel),
      ]);
      if (isDisconnectingRef.current) {
        return;
      }

      const wsUrl =
        `${CENTRIFUGO_WS_URL}?token=${encodeURIComponent(connectionToken)}` +
        `&channel=${encodeURIComponent(channel)}` +
        `&subToken=${encodeURIComponent(subscriptionToken)}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isDisconnectingRef.current) {
          ws.close();
          return;
        }
        reconnectAttemptsRef.current = 0;
        setIsConnected(true);
        onConnectionChangeRef.current('connected');
        // Reconcile on every (re)connect: fetch anything missed while offline via the `after`
        // cursor. Idempotent in the store, so an initial connect is harmless.
        onReconcileRef.current(conversationId);
        hasConnectedOnceRef.current = true;
      };

      ws.onmessage = (messageEvent: MessageEvent) => {
        handleRawMessage(messageEvent.data as string);
      };

      ws.onerror = () => {
        // Handled in onclose (onerror always precedes onclose).
      };

      ws.onclose = () => {
        if (isDisconnectingRef.current) {
          return;
        }
        wsRef.current = null;
        setIsConnected(false);
        onConnectionChangeRef.current(
          hasConnectedOnceRef.current ? 'reconnecting' : 'disconnected',
        );
        scheduleReconnect();
      };
    } catch {
      if (!isDisconnectingRef.current) {
        onConnectionChangeRef.current('reconnecting');
        scheduleReconnect();
      }
    }
  }, [conversationId, handleRawMessage, scheduleReconnect]);

  const disconnect = useCallback(() => {
    isDisconnectingRef.current = true;
    clearReconnectTimer();
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    reconnectAttemptsRef.current = 0;
  }, [clearReconnectTimer]);

  useEffect(() => {
    if (!conversationId) {
      return;
    }
    isDisconnectingRef.current = false;
    hasConnectedOnceRef.current = false;
    reconnectAttemptsRef.current = 0;
    onConnectionChangeRef.current('connecting');
    connect();

    return () => {
      disconnect();
    };
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { isConnected, disconnect };
}
