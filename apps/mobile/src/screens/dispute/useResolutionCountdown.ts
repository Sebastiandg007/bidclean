/**
 * useResolutionCountdown — a display-only countdown derived from the durable server deadline.
 *
 * It is a DISPLAY of the server-authoritative `resolutionDeadline`, NOT an authoritative client
 * timer (Spec 21 · P14). On expiry it re-fetches via `GET` (the store's reconcile) rather than
 * mutating state locally — the server SLA sweep is the guarantee, the countdown is advisory.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

/** The countdown shape surfaced to the UI. */
export interface ResolutionCountdown {
  /** Milliseconds remaining until the deadline (never negative). */
  readonly remainingMs: number;
  /** Whether the deadline has passed (the display should reflect "resolving"). */
  readonly expired: boolean;
}

const TICK_INTERVAL_MS = 1000;

/**
 * Derive a live countdown from the durable ISO `deadline`. `onExpire` is invoked once when the
 * deadline first passes (the caller re-fetches via `GET`). Returns `remainingMs`/`expired` for
 * display only.
 */
export function useResolutionCountdown(
  deadline: string | null,
  onExpire?: () => void,
): ResolutionCountdown {
  const deadlineMs = useMemo(() => (deadline ? Date.parse(deadline) : null), [deadline]);
  const [now, setNow] = useState<number>(() => Date.now());
  const firedRef = useRef<boolean>(false);

  useEffect(() => {
    firedRef.current = false;
    if (deadlineMs === null) {
      return;
    }
    const id = setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [deadlineMs]);

  const remainingMs = deadlineMs === null ? 0 : Math.max(0, deadlineMs - now);
  const expired = deadlineMs !== null && remainingMs === 0;

  useEffect(() => {
    if (expired && !firedRef.current) {
      firedRef.current = true;
      onExpire?.();
    }
  }, [expired, onExpire]);

  return { remainingMs, expired };
}
