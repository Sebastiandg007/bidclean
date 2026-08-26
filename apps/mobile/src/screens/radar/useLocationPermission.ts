/**
 * useLocationPermission — Location permission and GPS tracking hook for the Offer Radar.
 *
 * Responsibilities:
 * - Requests foreground location permission with clear i18n explanation
 * - Watches position with battery-aware accuracy settings:
 *   - Foreground: Accuracy.High (precise position for map display)
 *   - Background/inactive: Accuracy.Balanced (significant-change only)
 * - Provides fallback state when permission denied (open settings CTA)
 * - GPS is used ONLY for: map centering, distance display, position marker
 * - GPS is NEVER used for offer eligibility (that's work zone based)
 * - GPS is NEVER persisted by the backend (memory only for display)
 *
 * @requirements 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import type { AppStateStatus } from 'react-native';
import * as Location from 'expo-location';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Permission status reported by this hook */
export type LocationPermissionStatus = 'granted' | 'denied' | 'undetermined';

/** GPS coordinate pair (memory only — never sent to backend) */
export interface GpsCoordinate {
  lat: number;
  lng: number;
}

/** Return type for the useLocationPermission hook */
export interface UseLocationPermissionReturn {
  /** Current permission status */
  status: LocationPermissionStatus;
  /** Latest GPS coordinate (null if permission not granted or not yet acquired) */
  location: GpsCoordinate | null;
  /** Whether the initial permission check has completed */
  isLoading: boolean;
  /** Request foreground location permission with explanation dialog */
  requestPermission: () => Promise<void>;
  /** Open device app settings (for users who denied permission) */
  openSettings: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Minimum distance change (meters) required to trigger a position update
 * when the app is in the foreground.
 */
const FOREGROUND_DISTANCE_INTERVAL_METERS = 10;

/**
 * Minimum distance change (meters) required to trigger a position update
 * when the app is backgrounded or inactive (battery optimization).
 */
const BACKGROUND_DISTANCE_INTERVAL_METERS = 50;

/**
 * Minimum time interval (ms) between position updates in the foreground.
 */
const FOREGROUND_TIME_INTERVAL_MS = 5_000;

/**
 * Minimum time interval (ms) between position updates when backgrounded.
 */
const BACKGROUND_TIME_INTERVAL_MS = 30_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Maps expo-location PermissionStatus to our simplified status enum.
 */
function mapPermissionStatus(
  expoStatus: Location.PermissionStatus,
): LocationPermissionStatus {
  switch (expoStatus) {
    case Location.PermissionStatus.GRANTED:
      return 'granted';
    case Location.PermissionStatus.DENIED:
      return 'denied';
    case Location.PermissionStatus.UNDETERMINED:
    default:
      return 'undetermined';
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Custom hook for managing location permission and GPS tracking on the Radar screen.
 *
 * GPS is used ONLY for map centering, distance display, and position marker.
 * It is NEVER used for offer eligibility and NEVER persisted by the backend.
 *
 * @returns Permission status, current location, loading state, and action functions
 */
export function useLocationPermission(): UseLocationPermissionReturn {
  // ─── State ─────────────────────────────────────────────────────────────

  const [status, setStatus] = useState<LocationPermissionStatus>('undetermined');
  const [location, setLocation] = useState<GpsCoordinate | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // ─── Refs ──────────────────────────────────────────────────────────────

  const watchSubscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const isMountedRef = useRef(true);

  // ─── Permission Check ──────────────────────────────────────────────────

  const checkPermission = useCallback(async (): Promise<LocationPermissionStatus> => {
    try {
      const { status: expoStatus } = await Location.getForegroundPermissionsAsync();
      const mapped = mapPermissionStatus(expoStatus);

      if (isMountedRef.current) {
        setStatus(mapped);
      }

      return mapped;
    } catch {
      if (isMountedRef.current) {
        setStatus('denied');
      }
      return 'denied';
    }
  }, []);

  // ─── Position Watching ─────────────────────────────────────────────────

  const stopWatching = useCallback(() => {
    if (watchSubscriptionRef.current) {
      watchSubscriptionRef.current.remove();
      watchSubscriptionRef.current = null;
    }
  }, []);

  const startWatching = useCallback(
    async (isForegrounded: boolean) => {
      // Stop any existing watch before starting a new one
      stopWatching();

      const accuracy = isForegrounded
        ? Location.Accuracy.High
        : Location.Accuracy.Balanced;

      const distanceInterval = isForegrounded
        ? FOREGROUND_DISTANCE_INTERVAL_METERS
        : BACKGROUND_DISTANCE_INTERVAL_METERS;

      const timeInterval = isForegrounded
        ? FOREGROUND_TIME_INTERVAL_MS
        : BACKGROUND_TIME_INTERVAL_MS;

      try {
        const subscription = await Location.watchPositionAsync(
          {
            accuracy,
            distanceInterval,
            timeInterval,
          },
          (newLocation) => {
            if (isMountedRef.current) {
              setLocation({
                lat: newLocation.coords.latitude,
                lng: newLocation.coords.longitude,
              });
            }
          },
        );

        watchSubscriptionRef.current = subscription;
      } catch {
        // Location watch failed — position stays null
        // This can happen if permission was revoked externally
        if (isMountedRef.current) {
          setLocation(null);
        }
      }
    },
    [stopWatching],
  );

  // ─── Permission Request ────────────────────────────────────────────────

  const requestPermission = useCallback(async (): Promise<void> => {
    try {
      const { status: expoStatus } = await Location.requestForegroundPermissionsAsync();
      const mapped = mapPermissionStatus(expoStatus);

      if (isMountedRef.current) {
        setStatus(mapped);
      }

      if (mapped === 'granted') {
        const isForegrounded = appStateRef.current === 'active';
        await startWatching(isForegrounded);
      }
    } catch {
      if (isMountedRef.current) {
        setStatus('denied');
      }
    }
  }, [startWatching]);

  // ─── Open Device Settings ──────────────────────────────────────────────

  const openSettings = useCallback((): void => {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
    }
  }, []);

  // ─── AppState Listener (Battery Optimization) ──────────────────────────

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextAppState;

      // Only react to foreground ↔ background transitions when permission is granted
      if (status !== 'granted') return;

      const wasActive = previousState === 'active';
      const isActive = nextAppState === 'active';

      if (wasActive && !isActive) {
        // App moved to background → switch to balanced accuracy (battery optimization)
        startWatching(false);
      } else if (!wasActive && isActive) {
        // App returned to foreground → switch to high accuracy
        startWatching(true);
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [status, startWatching]);

  // ─── Initial Permission Check & Watch Setup ────────────────────────────

  useEffect(() => {
    isMountedRef.current = true;

    const initialize = async () => {
      const currentStatus = await checkPermission();

      if (currentStatus === 'granted') {
        const isForegrounded = AppState.currentState === 'active';
        await startWatching(isForegrounded);
      }

      if (isMountedRef.current) {
        setIsLoading(false);
      }
    };

    initialize();

    return () => {
      isMountedRef.current = false;
      stopWatching();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Return ────────────────────────────────────────────────────────────

  return {
    status,
    location,
    isLoading,
    requestPermission,
    openSettings,
  };
}
