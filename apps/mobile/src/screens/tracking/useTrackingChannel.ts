/**
 * useTrackingChannel (Host) — read-only WebSocket subscription to a session's Centrifugo channel.
 *
 * Mirrors `useChatChannel`'s resilient skeleton (raw WebSocket, connection + subscription token
 * fetch, push-envelope unwrap, bounded exponential-backoff reconnect 1s→…→30s, foreground reconcile
 * via `GET` on every (re)connect, teardown on unmount). It parses the server's `position` + `state`
 * signals and dispatches them to the store. The Host is a READ-ONLY subscriber — there is no publish
 * path (the Cleaner never publishes either; the server is the sole publisher, Option A). Transport
 * only: correctness lives in the DB state machine, reconciled via `GET`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchConnectionTokenRequest,
  fetchSessionChannelTokenRequest,
} from './tracking.api';
import {
  CENTRIFUGO_WS_URL,
  WS_INITIAL_BACKOFF_MS,
  WS_MAX_BACKOFF_MS,
  serviceChannelForSession,
} from './tracking.constants';
import type { ConnectionStatus, PositionSignal, StateSignal } from './tracking.types';

export interface UseTrackingChannelOptions {
  readonly sessionId: string;
  readonly onLivePosition: (signal: PositionSignal) => void;
  readonly onStateSignal: (signal: StateSignal) => void;
  readonly onConnectionChange: (status: ConnectionStatus) => void;
  readonly onReconcile: (sessionId: string) => void;
}

export interface UseTrackingChannelReturn {
  readonly isConnected: boolean;
  readonly disconnect: () => void;
}

const VALID_STATES = new Set<StateSignal['state']>([
  'MATCHED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
  'CANCELED',
  'EXPIRED',
]);

/** Exponential backoff capped at the max (1s, 2s, 4s, …, 30s). */
function calculateBackoffDelay(attempt: number): number {
  return Math.min(WS_INITIAL_BACKOFF_MS * Math.pow(2, attempt), WS_MAX_BACKOFF_MS);
}

/** Unwrap the Centrifugo push envelope (matches the chat/radar hooks). */
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

/** Validate + narrow a raw payload into a PositionSignal; null when malformed. */
function parsePosition(payload: unknown): PositionSignal | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (record.type !== 'position') {
    return null;
  }
  if (
    typeof record.lat !== 'number' ||
    typeof record.lng !== 'number' ||
    typeof record.accuracy !== 'number' ||
    typeof record.at !== 'number'
  ) {
    return null;
  }
  return record as unknown as PositionSignal;
}

/** Validate + narrow a raw payload into a StateSignal; null when it is not one. */
function parseState(payload: unknown): StateSignal | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (record.type !== 'state' || typeof record.state !== 'string') {
    return null;
  }
  if (!VALID_STATES.has(record.state as StateSignal['state'])) {
    return null;
  }
  return record as unknown as StateSignal;
}

/** Manage a read-only WebSocket subscription to the session channel, dispatching parsed signals. */
export function useTrackingChannel(options: UseTrackingChannelOptions): UseTrackingChannelReturn {
  const { sessionId, onLivePosition, onStateSignal, onConnectionChange, onReconcile } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const isDisconnectingRef = useRef<boolean>(false);
  const hasConnectedOnceRef = useRef<boolean>(false);

  const onLivePositionRef = useRef(onLivePosition);
  const onStateSignalRef = useRef(onStateSignal);
  const onConnectionChangeRef = useRef(onConnectionChange);
  const onReconcileRef = useRef(onReconcile);

  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    onLivePositionRef.current = onLivePosition;
    onStateSignalRef.current = onStateSignal;
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
      const payload = unwrapEnvelope(JSON.parse(rawData));
      const position = parsePosition(payload);
      if (position !== null) {
        onLivePositionRef.current(position);
        return;
      }
      const state = parseState(payload);
      if (state !== null) {
        onStateSignalRef.current(state);
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
    reconnectTimerRef.current = setTimeout(() => {
      reconnectAttemptsRef.current = attempt + 1;
      void connect();
    }, calculateBackoffDelay(attempt));
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
      const channel = serviceChannelForSession(sessionId);
      const [connectionToken, subscriptionToken] = await Promise.all([
        fetchConnectionTokenRequest(),
        fetchSessionChannelTokenRequest(channel),
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
        // Reconcile on every (re)connect: fetch the authoritative state via GET (idempotent).
        onReconcileRef.current(sessionId);
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
  }, [sessionId, handleRawMessage, scheduleReconnect]);

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
    if (!sessionId) {
      return;
    }
    isDisconnectingRef.current = false;
    hasConnectedOnceRef.current = false;
    reconnectAttemptsRef.current = 0;
    onConnectionChangeRef.current('connecting');
    void connect();

    return () => {
      disconnect();
    };
  }, [sessionId, connect, disconnect]);

  return { isConnected, disconnect };
}
