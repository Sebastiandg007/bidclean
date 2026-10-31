/**
 * tracking.store — Zustand store for service tracking (one store per domain, Spec 17).
 *
 * Holds the authoritative session (from `GET`), the latest ephemeral live position (never
 * persisted, only the newest frame is kept), and the connection status. Realtime signals are
 * best-effort: a `state` signal is applied idempotently and NEVER regresses the lifecycle (an
 * older/illegal transition is ignored); the authoritative state is always recoverable via
 * `reconcile()` (a `GET`). The store owns no transport/reconnect logic (that lives in
 * `useTrackingChannel`). Errors surface as i18n key strings.
 */

import { create } from 'zustand';

import {
  cancelRequest,
  getSessionRequest,
  postPositionRequest,
  startEnRouteRequest,
  startRequest,
} from './tracking.api';
import { TRACKING_I18N_KEYS } from './tracking.constants';
import type {
  ConnectionStatus,
  LivePosition,
  PositionSignal,
  ServiceSession,
  SessionState,
  StateSignal,
} from './tracking.types';

/** Monotonic rank of each lifecycle state so a signal can never regress the session. */
const STATE_RANK: Record<SessionState, number> = {
  MATCHED: 0,
  EN_ROUTE: 1,
  ARRIVED: 2,
  IN_PROGRESS: 3,
  CANCELED: 4,
  EXPIRED: 4,
};

/** Whether `next` is a forward (non-regressing) move from `current`. */
function isForward(current: SessionState, next: SessionState): boolean {
  return STATE_RANK[next] > STATE_RANK[current];
}

export interface TrackingState {
  session: ServiceSession | null;
  livePosition: LivePosition | null;
  connectionStatus: ConnectionStatus;
  error: string | null;
}

export interface TrackingActions {
  /** Load (or reload) the authoritative session via `GET`. */
  loadSession: (sessionId: string) => Promise<void>;
  /** Cleaner marks heading out (MATCHED → EN_ROUTE). */
  startEnRoute: (sessionId: string) => Promise<void>;
  /** Cleaner reports a position sample (server evaluates + relays). Returns the fresh session. */
  reportPosition: (sessionId: string, sample: LivePosition) => Promise<void>;
  /** Cleaner begins work (ARRIVED → IN_PROGRESS). */
  markStarted: (sessionId: string) => Promise<void>;
  /** Explicit participant cancel. */
  cancel: (sessionId: string) => Promise<void>;
  /** Apply a live position frame arriving over the channel (ephemeral; newest wins). */
  onLivePosition: (signal: PositionSignal) => void;
  /** Apply a state signal idempotently, ignoring regressions/illegal transitions. */
  onStateSignal: (signal: StateSignal) => void;
  /** Reconcile the authoritative state via `GET` (best-effort; keeps state on failure). */
  reconcile: (sessionId: string) => Promise<void>;
  /** Set the connection status (driven by the realtime hook). */
  setConnectionStatus: (status: ConnectionStatus) => void;
  /** Reset to the initial state. */
  reset: () => void;
}

export type TrackingStore = TrackingState & TrackingActions;

const initialState: TrackingState = {
  session: null,
  livePosition: null,
  connectionStatus: 'disconnected',
  error: null,
};

export const useTrackingStore = create<TrackingStore>((set, get) => ({
  ...initialState,

  loadSession: async (sessionId) => {
    set({ error: null });
    try {
      const session = await getSessionRequest(sessionId);
      set({ session });
    } catch {
      set({ error: TRACKING_I18N_KEYS.LOAD_ERROR });
    }
  },

  startEnRoute: async (sessionId) => {
    set({ error: null });
    try {
      const session = await startEnRouteRequest(sessionId);
      set({ session });
    } catch {
      set({ error: TRACKING_I18N_KEYS.LOAD_ERROR });
    }
  },

  reportPosition: async (sessionId, sample) => {
    try {
      const session = await postPositionRequest(sessionId, sample);
      set({ session });
    } catch {
      // Best-effort: a dropped sample never corrupts state (reconciled via GET).
    }
  },

  markStarted: async (sessionId) => {
    set({ error: null });
    try {
      const session = await startRequest(sessionId);
      set({ session });
    } catch {
      set({ error: TRACKING_I18N_KEYS.LOAD_ERROR });
    }
  },

  cancel: async (sessionId) => {
    set({ error: null });
    try {
      const session = await cancelRequest(sessionId);
      set({ session });
    } catch {
      set({ error: TRACKING_I18N_KEYS.LOAD_ERROR });
    }
  },

  onLivePosition: (signal) => {
    set({
      livePosition: {
        lat: signal.lat,
        lng: signal.lng,
        accuracy: signal.accuracy,
        heading: signal.heading ?? null,
        at: signal.at,
      },
    });
  },

  onStateSignal: (signal) => {
    const { session } = get();
    if (session === null) {
      // No authoritative baseline yet — a GET reconcile will establish it.
      return;
    }
    if (session.state === signal.state) {
      return; // idempotent no-op
    }
    if (!isForward(session.state, signal.state)) {
      return; // ignore a regression / illegal transition
    }
    set({
      session: {
        ...session,
        state: signal.state,
        endedReason: signal.endedReason ?? session.endedReason,
      },
    });
  },

  reconcile: async (sessionId) => {
    try {
      const session = await getSessionRequest(sessionId);
      set({ session });
    } catch {
      // Reconciliation is best-effort; keep existing state (recovered on the next attempt).
    }
  },

  setConnectionStatus: (status) => {
    set({ connectionStatus: status });
  },

  reset: () => {
    set({ ...initialState });
  },
}));

/** Convenience hook returning the full tracking store. */
export function useTracking(): TrackingStore {
  return useTrackingStore();
}

export default useTracking;
