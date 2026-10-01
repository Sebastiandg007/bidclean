/**
 * useCallSignaling — routes call-control signals off the EXISTING chat conversation channel.
 *
 * Calls reuse `chat:conversation:{id}` (no new channel, no new token surface): the same Centrifugo
 * channel the two participants already subscribe to for messages also carries the call-control
 * events (invite/ringing/accept/decline/cancel/end/busy). This hook mirrors `useChatChannel`'s
 * transport lifecycle (raw WebSocket, bounded backoff, envelope unwrap) but only cares about
 * `call_*` frames, dispatching each into the voip store, which applies them idempotently and never
 * regresses call status (P15). Transport only — no call state lives here.
 *
 * In a fully-integrated app the chat channel is a single shared subscription; to avoid a second
 * socket per conversation, `ChatScreen` may instead forward parsed call frames from its existing
 * `useChatChannel`. This hook exists for screens/tests that want call signaling in isolation and to
 * keep the seam explicit; it is safe to run alongside chat (idempotent store application).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchConnectionTokenRequest,
  fetchSubscriptionTokenRequest,
} from '../chat.api';
import {
  CENTRIFUGO_WS_URL,
  WS_INITIAL_BACKOFF_MS,
  WS_MAX_BACKOFF_MS,
  chatChannelForConversation,
} from '../chat.constants';
import {
  CallSignalType,
  type CallSignal,
  type EndReason,
  type MediaKind,
} from './voip.types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UseCallSignalingOptions {
  /** The conversation whose channel carries this call's control events. */
  conversationId: string;
  /** Called with each parsed call-control signal (the store applies it idempotently). */
  onSignal: (conversationId: string, signal: CallSignal) => void;
}

export interface UseCallSignalingReturn {
  /** Whether the signaling socket is currently connected. */
  isConnected: boolean;
  /** Manually tear down the connection. */
  disconnect: () => void;
}

// ─── Pure parsing ──────────────────────────────────────────────────────────────

/** The set of recognized call signal type strings. */
const CALL_SIGNAL_TYPES: ReadonlySet<string> = new Set(Object.values(CallSignalType));

/** Unwrap the Centrifugo push envelope (identical handling to `useChatChannel`). */
function unwrapEnvelope(raw: unknown): unknown {
  const data = raw as {
    result?: { channel?: unknown; data?: unknown };
    push?: { pub?: { data?: unknown } };
  };
  if (data?.result?.channel !== undefined) {
    return data.result.data;
  }
  return data?.push?.pub?.data ?? raw;
}

/** Validate + narrow a raw payload into a CallSignal; null when it is not a call frame. */
export function parseCallSignal(data: unknown): CallSignal | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const record = data as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== 'string' || !CALL_SIGNAL_TYPES.has(type)) {
    return null;
  }
  if (typeof record.callId !== 'string') {
    return null;
  }

  switch (type) {
    case CallSignalType.CALL_INVITE: {
      if (
        typeof record.conversationId !== 'string' ||
        (record.mediaKind !== 'AUDIO' && record.mediaKind !== 'VIDEO')
      ) {
        return null;
      }
      return {
        type: CallSignalType.CALL_INVITE,
        callId: record.callId,
        conversationId: record.conversationId,
        initiatorId: typeof record.initiatorId === 'string' ? record.initiatorId : null,
        mediaKind: record.mediaKind as MediaKind,
      };
    }
    case CallSignalType.CALL_END: {
      const endReason = record.endReason;
      if (typeof endReason !== 'string') {
        return null;
      }
      return {
        type: CallSignalType.CALL_END,
        callId: record.callId,
        endReason: endReason as EndReason,
        durationSeconds:
          typeof record.durationSeconds === 'number' ? record.durationSeconds : null,
      };
    }
    case CallSignalType.CALL_BUSY:
      return { type: CallSignalType.CALL_BUSY, callId: record.callId };
    case CallSignalType.CALL_RINGING:
    case CallSignalType.CALL_ACCEPT:
    case CallSignalType.CALL_DECLINE:
    case CallSignalType.CALL_CANCEL:
      return { type, callId: record.callId };
    default:
      return null;
  }
}

/** Exponential backoff capped at the max (1s, 2s, 4s, …, 30s). */
function calculateBackoffDelay(attempt: number): number {
  const delay = WS_INITIAL_BACKOFF_MS * Math.pow(2, attempt);
  return Math.min(delay, WS_MAX_BACKOFF_MS);
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Subscribe to a conversation's Centrifugo channel and dispatch parsed call-control signals to the
 * store. Reconnects with bounded backoff; the store's `reconcile` (GET) is the authority after any
 * dropped frame, so a missed signal never corrupts call state.
 */
export function useCallSignaling(options: UseCallSignalingOptions): UseCallSignalingReturn {
  const { conversationId, onSignal } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const isDisconnectingRef = useRef<boolean>(false);
  const onSignalRef = useRef(onSignal);

  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    onSignalRef.current = onSignal;
  });

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const handleRawMessage = useCallback(
    (rawData: string) => {
      try {
        const parsed = JSON.parse(rawData);
        const payload = unwrapEnvelope(parsed);
        const signal = parseCallSignal(payload);
        if (signal !== null) {
          onSignalRef.current(conversationId, signal);
        }
      } catch {
        // Malformed frame — ignore (defensive, no user impact).
      }
    },
    [conversationId],
  );

  const scheduleReconnect = useCallback(() => {
    if (isDisconnectingRef.current) {
      return;
    }
    const attempt = reconnectAttemptsRef.current;
    const delay = calculateBackoffDelay(attempt);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectAttemptsRef.current = attempt + 1;
      void connect();
    }, delay);
  }, []);

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
        scheduleReconnect();
      };
    } catch {
      if (!isDisconnectingRef.current) {
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
    reconnectAttemptsRef.current = 0;
    void connect();

    return () => {
      disconnect();
    };
  }, [conversationId, connect, disconnect]);

  return { isConnected, disconnect };
}
