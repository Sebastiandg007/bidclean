/**
 * useRadarReconciliation — Orchestrates the reconciliation lifecycle
 * between the Centrifugo WebSocket and REST polling fallback.
 *
 * Responsibilities:
 * - Wires useCentrifugoChannel callbacks to the Zustand store
 * - On WebSocket reconnect: calls store.reconcile() (fetches /snapshot)
 * - Polling fallback: starts 30s interval REST polling after 3+ WS failures
 * - Polling max duration: 5 minutes, then stops polling and shows permanent "reconnecting"
 * - Stops polling immediately when WebSocket recovers
 * - Ensures mutual exclusivity: WS and polling never run simultaneously (max 5s overlap)
 *
 * @requirements 3.6, 13.4, 13.6, 14.3
 */

import { useEffect, useRef, useCallback, useState } from 'react';

import { useRadarStore } from '../useRadarStore';
import { useCentrifugoChannel } from '../useCentrifugoChannel';
import {
  RADAR_POLLING_INTERVAL_MS,
  RADAR_MAX_POLLING_DURATION_MS,
  WS_POLLING_OVERLAP_MAX_MS,
} from '../radar.constants';
import type { RadarOffer } from '../radar.types';

// ─── Return Type ─────────────────────────────────────────────────────────────

export interface UseRadarReconciliationReturn {
  /** Whether the WebSocket is currently connected */
  isConnected: boolean;
  /** Whether REST polling fallback is active */
  isPolling: boolean;
  /** Number of failed WebSocket reconnection attempts */
  reconnectAttempts: number;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Manages the full reconciliation lifecycle for the Offer Radar.
 *
 * Integrates `useCentrifugoChannel` internally and wires its callbacks
 * to the Zustand store and polling fallback logic.
 *
 * @param cleanerId - The authenticated Cleaner's user ID
 * @returns Connection status, polling state, and reconnection attempt count
 */
export function useRadarReconciliation(cleanerId: string): UseRadarReconciliationReturn {
  // ─── Store Actions ───────────────────────────────────────────────────────

  const handleOfferNew = useRadarStore((state) => state.handleOfferNew);
  const handleOfferStatusChanged = useRadarStore((state) => state.handleOfferStatusChanged);
  const setConnectionStatus = useRadarStore((state) => state.setConnectionStatus);
  const reconcile = useRadarStore((state) => state.reconcile);
  const refreshOffers = useRadarStore((state) => state.refreshOffers);
  const markAllStale = useRadarStore((state) => state.markAllStale);

  // ─── Polling State ───────────────────────────────────────────────────────

  const [isPolling, setIsPolling] = useState(false);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingStartTimeRef = useRef<number | null>(null);
  const pollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPollingActiveRef = useRef(false);

  // ─── Polling Lifecycle ───────────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current !== null) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    if (pollingTimeoutRef.current !== null) {
      clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }

    pollingStartTimeRef.current = null;
    isPollingActiveRef.current = false;
    setIsPolling(false);
  }, []);

  const startPolling = useCallback(() => {
    // Guard: don't start polling if already active
    if (isPollingActiveRef.current) return;

    isPollingActiveRef.current = true;
    pollingStartTimeRef.current = Date.now();
    setIsPolling(true);

    // Mark existing offers as potentially stale when entering polling mode
    markAllStale();

    // Start immediate first poll
    refreshOffers();

    // Set up interval for subsequent polls
    pollingIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - (pollingStartTimeRef.current ?? Date.now());

      if (elapsed >= RADAR_MAX_POLLING_DURATION_MS) {
        // Max polling duration exceeded — stop polling, show permanent reconnecting state
        stopPolling();
        setConnectionStatus('reconnecting');
        return;
      }

      refreshOffers();
    }, RADAR_POLLING_INTERVAL_MS);

    // Safety timeout: auto-stop after max duration + one interval buffer
    pollingTimeoutRef.current = setTimeout(() => {
      stopPolling();
      setConnectionStatus('reconnecting');
    }, RADAR_MAX_POLLING_DURATION_MS + RADAR_POLLING_INTERVAL_MS);
  }, [markAllStale, refreshOffers, stopPolling, setConnectionStatus]);

  // ─── WebSocket Callbacks ─────────────────────────────────────────────────

  const handleWsOfferNew = useCallback(
    (offer: RadarOffer) => {
      handleOfferNew(offer);
    },
    [handleOfferNew],
  );

  const handleWsOfferStatusChanged = useCallback(
    (offerId: string, state: string, changedAt: string) => {
      handleOfferStatusChanged(offerId, state, changedAt);
    },
    [handleOfferStatusChanged],
  );

  const handleConnectionChange = useCallback(
    (status: import('../radar.types').ConnectionStatus) => {
      setConnectionStatus(status);
    },
    [setConnectionStatus],
  );

  const handleReconnect = useCallback(() => {
    // WebSocket recovered — stop polling with a controlled overlap window
    // The overlap ensures we don't lose events during the transition
    if (isPollingActiveRef.current) {
      // Allow a brief overlap window (max 5s) for reconciliation to complete
      // before fully stopping polling
      setTimeout(() => {
        stopPolling();
      }, WS_POLLING_OVERLAP_MAX_MS);
    }

    // Trigger full reconciliation via REST /snapshot
    // REST always wins — this replaces all local state with server truth
    reconcile();
  }, [stopPolling, reconcile]);

  const handleFallbackNeeded = useCallback(() => {
    // WebSocket failed 3+ times — start REST polling fallback
    startPolling();
  }, [startPolling]);

  // ─── Centrifugo Channel Integration ──────────────────────────────────────

  const { isConnected, reconnectAttempts, disconnect } = useCentrifugoChannel({
    cleanerId,
    onOfferNew: handleWsOfferNew,
    onOfferStatusChanged: handleWsOfferStatusChanged,
    onConnectionChange: handleConnectionChange,
    onReconnect: handleReconnect,
    onFallbackNeeded: handleFallbackNeeded,
  });

  // ─── Cleanup on Unmount ──────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      stopPolling();
      disconnect();
    };
  }, [stopPolling, disconnect]);

  // ─── Return ──────────────────────────────────────────────────────────────

  return {
    isConnected,
    isPolling,
    reconnectAttempts,
  };
}
