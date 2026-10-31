/**
 * verification.store — Zustand store for on-arrival video verification (one store per domain, Spec 18).
 *
 * Holds the authoritative verification view (from `GET`), the derived Host classification, and a
 * transient upload flag. State application is idempotent and NEVER regresses to a pre-terminal state
 * once terminal (an out-of-order/older signal is ignored); the authoritative state is always
 * recoverable via `reconcile()`. The store NEVER holds a video URL or the raw score (there is
 * none exposed). Errors surface as i18n key strings.
 */

import { create } from 'zustand';

import { getVerificationRequest, uploadArrivalClip } from './verification.api';
import { toDisplayStatus, VERIFICATION_I18N_KEYS } from './verification.constants';
import type { DisplayStatus, RecordedClip, VerificationState, VerificationView } from './verification.types';

/** Monotonic rank so a signal can never regress a terminal verification. */
const STATE_RANK: Record<VerificationState, number> = {
  PENDING_UPLOAD: 0,
  UPLOADED: 1,
  PROCESSING: 2,
  MATCH: 3,
  NO_MATCH: 3,
  INCONCLUSIVE: 3,
  FAILED: 3,
  DISABLED: 3,
  EXPIRED: 3,
};

export interface VerificationStoreState {
  verification: VerificationView | null;
  isUploading: boolean;
  error: string | null;
}

export interface VerificationStoreActions {
  /** Load (or reload) the authoritative verification via `GET`. */
  load: (id: string) => Promise<void>;
  /** Compose request-upload → PUT → finalize for the recorded clip. */
  upload: (id: string, clip: RecordedClip) => Promise<void>;
  /** Apply a fetched view idempotently, ignoring regressions. */
  applyView: (view: VerificationView) => void;
  /** Reconcile the authoritative state via `GET` (best-effort; keeps state on failure). */
  reconcile: (id: string) => Promise<void>;
  /** The current UX display status (recording handled by the recorder, not the store). */
  displayStatus: () => DisplayStatus | null;
  /** Reset to the initial state. */
  reset: () => void;
}

export type VerificationStore = VerificationStoreState & VerificationStoreActions;

const initialState: VerificationStoreState = {
  verification: null,
  isUploading: false,
  error: null,
};

export const useVerificationStore = create<VerificationStore>((set, get) => ({
  ...initialState,

  load: async (id) => {
    set({ error: null });
    try {
      const view = await getVerificationRequest(id);
      get().applyView(view);
    } catch {
      set({ error: VERIFICATION_I18N_KEYS.LOAD_ERROR });
    }
  },

  upload: async (id, clip) => {
    set({ isUploading: true, error: null });
    try {
      const view = await uploadArrivalClip(id, clip);
      get().applyView(view);
    } catch {
      // Best-effort: a failed upload never blocks the service; the state reconciles via GET.
      set({ error: VERIFICATION_I18N_KEYS.LOAD_ERROR });
    } finally {
      set({ isUploading: false });
    }
  },

  applyView: (view) => {
    const current = get().verification;
    if (current !== null && STATE_RANK[view.state] < STATE_RANK[current.state]) {
      return; // ignore a regression from a stale/out-of-order fetch
    }
    set({ verification: view });
  },

  reconcile: async (id) => {
    try {
      const view = await getVerificationRequest(id);
      get().applyView(view);
    } catch {
      // Reconciliation is best-effort; keep existing state (recovered on the next attempt).
    }
  },

  displayStatus: () => {
    const { verification } = get();
    return verification === null ? null : toDisplayStatus(verification.state);
  },

  reset: () => {
    set({ ...initialState });
  },
}));

/** Convenience hook returning the full verification store. */
export function useVerification(): VerificationStore {
  return useVerificationStore();
}

export default useVerification;
