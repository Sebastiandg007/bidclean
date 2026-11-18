/**
 * usePositionReporter (Cleaner) — reports position to the backend while EN_ROUTE (Spec 17, Option A).
 *
 * Requests foreground location permission, then watches position and POSTs each sample to the
 * backend position endpoint (via the store's `reportPosition`), throttled to the client send
 * cadence (`SERVICE_POSITION_MIN_INTERVAL_MS`). The Cleaner NEVER publishes to the Centrifugo
 * channel — the server evaluates the geofence and re-publishes to the Host. When permission is
 * denied/unavailable it degrades gracefully (exposes a status for an i18n explanation; never
 * crashes) — the session still functions via the server-side geofence on whatever coordinates are
 * provided. Reporting is active ONLY while the session is `EN_ROUTE`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';

import { SERVICE_POSITION_MIN_INTERVAL_MS } from './tracking.constants';
import { useTrackingStore } from './tracking.store';
import type { LivePosition, SessionState } from './tracking.types';

export type PermissionStatus = 'unknown' | 'granted' | 'denied';

export interface UsePositionReporterOptions {
  readonly sessionId: string;
  /** The current session state; reporting runs only while EN_ROUTE. */
  readonly state: SessionState | null;
}

export interface UsePositionReporterReturn {
  readonly permissionStatus: PermissionStatus;
  /** Request (or re-request) foreground location permission. */
  readonly requestPermission: () => Promise<void>;
}

/** Manage the Cleaner's location watch + throttled POST while EN_ROUTE. */
export function usePositionReporter(
  options: UsePositionReporterOptions,
): UsePositionReporterReturn {
  const { sessionId, state } = options;
  const reportPosition = useTrackingStore((store) => store.reportPosition);

  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('unknown');
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const lastSentAtRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);

  const stopWatching = useCallback(() => {
    if (watchRef.current) {
      watchRef.current.remove();
      watchRef.current = null;
    }
  }, []);

  const handleSample = useCallback(
    (location: Location.LocationObject) => {
      const now = Date.now();
      if (now - lastSentAtRef.current < SERVICE_POSITION_MIN_INTERVAL_MS) {
        return; // client-side pre-throttle (the server independently rate-limits)
      }
      lastSentAtRef.current = now;
      const sample: LivePosition = {
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        accuracy: location.coords.accuracy ?? Number.MAX_SAFE_INTEGER,
        heading: location.coords.heading ?? null,
        at: location.timestamp,
      };
      void reportPosition(sessionId, sample);
    },
    [reportPosition, sessionId],
  );

  const startWatching = useCallback(async () => {
    stopWatching();
    try {
      watchRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: SERVICE_POSITION_MIN_INTERVAL_MS },
        (location) => {
          if (isMountedRef.current) {
            handleSample(location);
          }
        },
      );
    } catch {
      // Watch failed (e.g. permission revoked externally) — degrade gracefully, never crash.
      if (isMountedRef.current) {
        setPermissionStatus('denied');
      }
    }
  }, [handleSample, stopWatching]);

  const requestPermission = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      const granted = status === 'granted';
      if (isMountedRef.current) {
        setPermissionStatus(granted ? 'granted' : 'denied');
      }
    } catch {
      if (isMountedRef.current) {
        setPermissionStatus('denied');
      }
    }
  }, []);

  // Drive the watch by (state === EN_ROUTE) AND (permission granted).
  useEffect(() => {
    isMountedRef.current = true;
    const shouldReport = state === 'EN_ROUTE' && permissionStatus === 'granted';
    if (shouldReport) {
      void startWatching();
    } else {
      stopWatching();
    }
    return () => {
      isMountedRef.current = false;
      stopWatching();
    };
  }, [state, permissionStatus, startWatching, stopWatching]);

  return { permissionStatus, requestPermission };
}
