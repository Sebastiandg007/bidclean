/**
 * useCentrifugoChannel — WebSocket hook for real-time offer delivery.
 *
 * Subscribes to the Cleaner's personal Centrifugo channel
 * (`offers:cleaner:{cleanerId}`) and dispatches incoming events
 * to the Zustand store. Handles:
 *
 * - Event parsing: offer_new → handleOfferNew, offer_status_changed → handleOfferStatusChanged
 * - Exponential backoff reconnection: 1s → 2s → 4s → 8s → 16s → 30s (capped)
 * - Fallback signal: emits after WS_FALLBACK_THRESHOLD (3) failed reconnection attempts
 * - Reconciliation: triggers full REST /snapshot fetch on successful reconnect
 * - Connection status tracking: connected → disconnected → reconnecting → connected
 * - Mutual exclusivity: WebSocket and polling never run simultaneously (max 5s overlap)
 * - Lifecycle: subscribe on mount, unsubscribe on unmount
 *
 * @requirements 3.1, 3.2, 3.3, 3.5, 3.6, 13.6
 */

import { useEffect, useRef, useCallback, useState } from 'react';

import type {
  RadarOffer,
  ConnectionStatus,
  OfferNewEvent,
  OfferStatusChangedEvent,
  RadarWebSocketEvent,
} from './radar.types';
import {
  WS_MAX_BACKOFF_MS,
  WS_FALLBACK_THRESHOLD,
  WS_INITIAL_BACKOFF_MS,
  WS_POLLING_OVERLAP_MAX_MS,
} from './radar.constants';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UseCentrifugoChannelOptions {
  /** The authenticated Cleaner's user ID for channel subscription */
  cleanerId: string;
  /** Callback when a new offer is delivered via WebSocket */
  onOfferNew: (offer: RadarOffer) => void;
  /** Callback when an offer's status changes (terminal state) */
  onOfferStatusChanged: (offerId: string, state: string, changedAt: string) => void;
  /** Callback when connection status transitions */
  onConnectionChange: (status: ConnectionStatus) => void;
  /** Callback triggered on successful reconnection (should trigger reconciliation) */
  onReconnect: () => void;
  /** Callback when polling fallback is needed (WS failed 3+ times) */
  onFallbackNeeded: () => void;
}

export interface UseCentrifugoChannelReturn {
  /** Whether the WebSocket is currently connected */
  isConnected: boolean;
  /** Number of failed reconnection attempts since last successful connection */
  reconnectAttempts: number;
  /** Manually disconnect the WebSocket (used for cleanup or forced disconnect) */
  disconnect: () => void;
}

// ─── Environment Config ──────────────────────────────────────────────────────

const CENTRIFUGO_WS_URL = process.env.EXPO_PUBLIC_CENTRIFUGO_WS_URL ?? 'wss://ws.bidclean.tech/connection/websocket';
const CENTRIFUGO_TOKEN_URL = process.env.EXPO_PUBLIC_CENTRIFUGO_TOKEN_URL ?? '/auth/centrifugo/token';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Fetches a connection token from the backend for Centrifugo auth.
 * The token is a JWT that authorizes the Cleaner to subscribe to their personal channel.
 */
async function fetchConnectionToken(): Promise<string> {
  const { apiClient } = await import('../../services/api.service');
  const response = await apiClient.get<{ token: string }>(CENTRIFUGO_TOKEN_URL);
  return response.data.token;
}

/**
 * Calculates exponential backoff delay capped at WS_MAX_BACKOFF_MS.
 * Sequence: 1s, 2s, 4s, 8s, 16s, 30s, 30s, 30s...
 */
function calculateBackoffDelay(attempt: number): number {
  const delay = WS_INITIAL_BACKOFF_MS * Math.pow(2, attempt);
  return Math.min(delay, WS_MAX_BACKOFF_MS);
}

/**
 * Validates and parses a raw WebSocket message into a typed event.
 * Returns null for unrecognized or malformed messages.
 */
function parseWebSocketEvent(data: unknown): RadarWebSocketEvent | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }

  const message = data as Record<string, unknown>;

  if (message.type === 'offer_new') {
    return validateOfferNewEvent(message);
  }

  if (message.type === 'offer_status_changed') {
    return validateOfferStatusChangedEvent(message);
  }

  return null;
}

function validateOfferNewEvent(message: Record<string, unknown>): OfferNewEvent | null {
  if (
    typeof message.offerId !== 'string' ||
    typeof message.serviceType !== 'string' ||
    typeof message.scheduledAt !== 'string' ||
    typeof message.publishedAt !== 'string' ||
    typeof message.distanceMeters !== 'number' ||
    typeof message.isUrgent !== 'boolean' ||
    !message.propertySnapshot ||
    !message.priceBreakdown ||
    !message.publicLocation
  ) {
    return null;
  }

  return message as unknown as OfferNewEvent;
}

function validateOfferStatusChangedEvent(
  message: Record<string, unknown>,
): OfferStatusChangedEvent | null {
  if (
    typeof message.offerId !== 'string' ||
    typeof message.state !== 'string' ||
    typeof message.changedAt !== 'string'
  ) {
    return null;
  }

  const validStates = ['CANCELLED', 'EXPIRED', 'MATCHED'];
  if (!validStates.includes(message.state as string)) {
    return null;
  }

  return message as unknown as OfferStatusChangedEvent;
}

/**
 * Converts an OfferNewEvent payload into a RadarOffer for the store.
 * Sets client-only fields (isViewed, isStale) to false.
 */
function eventToRadarOffer(event: OfferNewEvent): RadarOffer {
  return {
    offerId: event.offerId,
    propertySnapshot: event.propertySnapshot,
    serviceType: event.serviceType,
    description: event.description,
    scheduledAt: event.scheduledAt,
    timezone: event.timezone,
    estimatedDurationMinutes: event.estimatedDurationMinutes,
    priceBreakdown: event.priceBreakdown,
    distanceMeters: event.distanceMeters,
    publishedAt: event.publishedAt,
    isUrgent: event.isUrgent,
    publicLocation: event.publicLocation,
    isViewed: false,
    isStale: false,
  };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * React hook that manages a WebSocket connection to Centrifugo
 * for real-time offer delivery on the Cleaner's personal channel.
 *
 * Subscribes on mount, unsubscribes on unmount. Handles reconnection
 * with exponential backoff and emits fallback signals when persistent
 * failures are detected.
 */
export function useCentrifugoChannel(
  options: UseCentrifugoChannelOptions,
): UseCentrifugoChannelReturn {
  const {
    cleanerId,
    onOfferNew,
    onOfferStatusChanged,
    onConnectionChange,
    onReconnect,
    onFallbackNeeded,
  } = options;

  // ─── Mutable Refs ──────────────────────────────────────────────────────

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const isDisconnectingRef = useRef<boolean>(false);
  const hasConnectedOnceRef = useRef<boolean>(false);
  const fallbackEmittedRef = useRef<boolean>(false);
  const overlapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable callback refs to avoid stale closures
  const onOfferNewRef = useRef(onOfferNew);
  const onOfferStatusChangedRef = useRef(onOfferStatusChanged);
  const onConnectionChangeRef = useRef(onConnectionChange);
  const onReconnectRef = useRef(onReconnect);
  const onFallbackNeededRef = useRef(onFallbackNeeded);

  // ─── State ─────────────────────────────────────────────────────────────

  const [isConnected, setIsConnected] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  // Keep callback refs up to date
  useEffect(() => {
    onOfferNewRef.current = onOfferNew;
    onOfferStatusChangedRef.current = onOfferStatusChanged;
    onConnectionChangeRef.current = onConnectionChange;
    onReconnectRef.current = onReconnect;
    onFallbackNeededRef.current = onFallbackNeeded;
  });

  // ─── Connection Logic ──────────────────────────────────────────────────

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const clearOverlapTimer = useCallback(() => {
    if (overlapTimerRef.current !== null) {
      clearTimeout(overlapTimerRef.current);
      overlapTimerRef.current = null;
    }
  }, []);

  const handleMessage = useCallback((rawData: unknown) => {
    const event = parseWebSocketEvent(rawData);
    if (!event) return;

    switch (event.type) {
      case 'offer_new': {
        const offer = eventToRadarOffer(event);
        onOfferNewRef.current(offer);
        break;
      }
      case 'offer_status_changed': {
        onOfferStatusChangedRef.current(event.offerId, event.state, event.changedAt);
        break;
      }
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (isDisconnectingRef.current) return;

    const attempt = reconnectAttemptsRef.current;
    const delay = calculateBackoffDelay(attempt);

    // Update state for UI
    setReconnectAttempts(attempt);

    // Emit fallback signal after threshold (only once per disconnection cycle)
    if (attempt >= WS_FALLBACK_THRESHOLD && !fallbackEmittedRef.current) {
      fallbackEmittedRef.current = true;
      onFallbackNeededRef.current();
    }

    reconnectTimerRef.current = setTimeout(() => {
      reconnectAttemptsRef.current = attempt + 1;
      setReconnectAttempts(attempt + 1);
      connect(); // eslint-disable-line @typescript-eslint/no-use-before-define
    }, delay);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = useCallback(async () => {
    if (isDisconnectingRef.current) return;

    // Close any existing connection cleanly
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const token = await fetchConnectionToken();
      if (isDisconnectingRef.current) return;

      const channel = `offers:cleaner:${cleanerId}`;
      const wsUrl = `${CENTRIFUGO_WS_URL}?token=${encodeURIComponent(token)}&channel=${encodeURIComponent(channel)}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isDisconnectingRef.current) {
          ws.close();
          return;
        }

        const wasReconnect = hasConnectedOnceRef.current;

        // Reset reconnection state
        reconnectAttemptsRef.current = 0;
        fallbackEmittedRef.current = false;
        setReconnectAttempts(0);
        setIsConnected(true);

        // Update connection status
        onConnectionChangeRef.current('connected');

        if (wasReconnect) {
          // On reconnection: trigger reconciliation after a controlled overlap window
          // This ensures mutual exclusivity — WS and polling don't run simultaneously
          // The overlap timer gives polling time to stop before reconciliation begins
          clearOverlapTimer();
          overlapTimerRef.current = setTimeout(() => {
            onReconnectRef.current();
          }, Math.min(WS_POLLING_OVERLAP_MAX_MS, 1000));
        }

        hasConnectedOnceRef.current = true;
      };

      ws.onmessage = (messageEvent: MessageEvent) => {
        try {
          const data = JSON.parse(messageEvent.data as string);

          // Centrifugo wraps messages in a push/pub structure
          // Handle both direct payloads and wrapped payloads
          const payload = data?.result?.channel
            ? data.result.data
            : data?.push?.pub?.data ?? data;

          handleMessage(payload);
        } catch {
          // Malformed JSON — skip silently (defensive, no user impact)
        }
      };

      ws.onerror = () => {
        // Error handling is done in onclose — onerror always fires before onclose
      };

      ws.onclose = () => {
        if (isDisconnectingRef.current) return;

        wsRef.current = null;
        setIsConnected(false);

        // Determine status based on whether this is initial or reconnection
        const status: ConnectionStatus = hasConnectedOnceRef.current
          ? 'reconnecting'
          : 'disconnected';
        onConnectionChangeRef.current(status);

        scheduleReconnect();
      };
    } catch {
      // Token fetch failed — treat as connection failure and retry
      if (!isDisconnectingRef.current) {
        onConnectionChangeRef.current('reconnecting');
        scheduleReconnect();
      }
    }
  }, [cleanerId, handleMessage, scheduleReconnect, clearOverlapTimer]);

  // ─── Disconnect ────────────────────────────────────────────────────────

  const disconnect = useCallback(() => {
    isDisconnectingRef.current = true;
    clearReconnectTimer();
    clearOverlapTimer();

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    setIsConnected(false);
    reconnectAttemptsRef.current = 0;
    setReconnectAttempts(0);
  }, [clearReconnectTimer, clearOverlapTimer]);

  // ─── Lifecycle ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!cleanerId) return;

    isDisconnectingRef.current = false;
    hasConnectedOnceRef.current = false;
    fallbackEmittedRef.current = false;
    reconnectAttemptsRef.current = 0;

    connect();

    return () => {
      disconnect();
    };
  }, [cleanerId]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    isConnected,
    reconnectAttempts,
    disconnect,
  };
}
