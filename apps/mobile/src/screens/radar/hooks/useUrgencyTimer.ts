/**
 * useUrgencyTimer — 60-second interval timer for urgency recalculation.
 *
 * Periodically recalculates `isUrgent` for all offers in the store.
 * An offer is urgent when: (scheduledAt - now) <= 2 hours.
 *
 * This timer exists because urgency is a time-dependent property that
 * changes without any server event — an offer can transition from
 * non-urgent to urgent purely through time passing.
 *
 * The timer runs while the radar screen is mounted and automatically
 * cleans up on unmount.
 */

import { useEffect, useRef } from 'react';

import { URGENCY_THRESHOLD_MS, URGENCY_REFRESH_INTERVAL_MS } from '../radar.constants';
import { useRadarStore } from '../useRadarStore';
import type { RadarOffer } from '../radar.types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UseUrgencyTimerOptions {
  /** Whether the timer is active (default: true) */
  enabled?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Determines whether an offer should be marked as urgent.
 * An offer is urgent if it's scheduled within 2 hours from now and still in the future.
 */
function computeIsUrgent(scheduledAt: string): boolean {
  const scheduledTime = new Date(scheduledAt).getTime();
  const now = Date.now();
  const timeUntilScheduled = scheduledTime - now;
  return timeUntilScheduled > 0 && timeUntilScheduled <= URGENCY_THRESHOLD_MS;
}

/**
 * Recalculates isUrgent for all offers and updates those that changed.
 * Only triggers a store update if at least one offer's urgency changed.
 */
function refreshUrgencyValues(): void {
  const { offers } = useRadarStore.getState();

  if (offers.size === 0) return;

  let hasChanges = false;
  const updatedOffers = new Map<string, RadarOffer>();

  for (const [id, offer] of offers) {
    const newIsUrgent = computeIsUrgent(offer.scheduledAt);

    if (newIsUrgent !== offer.isUrgent) {
      hasChanges = true;
      updatedOffers.set(id, { ...offer, isUrgent: newIsUrgent });
    } else {
      updatedOffers.set(id, offer);
    }
  }

  // Only update the store if something actually changed
  if (hasChanges) {
    useRadarStore.setState({ offers: updatedOffers });
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Starts a 60-second interval that recalculates `isUrgent` for all radar offers.
 *
 * Usage:
 * ```tsx
 * function RadarScreen() {
 *   useUrgencyTimer();
 *   // ...
 * }
 * ```
 *
 * @param options.enabled - Whether the timer should be active (default: true)
 */
export function useUrgencyTimer({ enabled = true }: UseUrgencyTimerOptions = {}): void {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Run once immediately on mount/enable
    refreshUrgencyValues();

    // Set up the 60-second recurring timer
    intervalRef.current = setInterval(refreshUrgencyValues, URGENCY_REFRESH_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled]);
}

// Export helper for testing
export { computeIsUrgent, refreshUrgencyValues };

export default useUrgencyTimer;
