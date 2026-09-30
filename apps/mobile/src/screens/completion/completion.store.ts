/**
 * completion.store — Zustand store for service-completion (one store per domain, Spec 20).
 *
 * Holds the authoritative completion (from `GET`) + a best-effort connection status. Confirm/dispute
 * are applied optimistically and reconciled via `GET`; state application is idempotent and never
 * regresses a terminal completion. `GET` reconciliation is authority; realtime is advisory. Errors
 * surface as i18n key strings.
 */

import { create } from 'zustand';

import {
  confirmCompletionRequest,
  disputeCompletionRequest,
  getCompletionRequest,
  postReleaseDisputeRequest,
  submitRatingRequest,
} from './completion.api';
import { COMPLETION_I18N_KEYS } from './completion.constants';
import type { CompletionState, ConnectionStatus, ServiceCompletion } from './completion.types';

/** Terminal completion states never accept a regressing optimistic update. */
const TERMINAL_STATES: readonly CompletionState[] = ['CONFIRMED', 'AUTO_RELEASED', 'DISPUTED'];

export interface CompletionStoreState {
  completion: ServiceCompletion | null;
  connectionStatus: ConnectionStatus;
  error: string | null;
  isSubmitting: boolean;
}

export interface CompletionStoreActions {
  /** Load (or reload) the authoritative completion via `GET`. */
  loadCompletion: (id: string) => Promise<void>;
  /** Host confirms; optimistic, then reconciled via `GET`. */
  confirm: (id: string) => Promise<void>;
  /** Host opens a pre-release dispute; optimistic, then reconciled via `GET`. */
  dispute: (id: string) => Promise<void>;
  /** Host opens a post-release dispute (only accepted once released); reconciled via `GET`. */
  postReleaseDispute: (id: string) => Promise<void>;
  /** Submit one rating side (never gating); reconciled via `GET`. */
  submitRating: (id: string, stars: number, comment?: string) => Promise<void>;
  /** Reconcile the authoritative completion via `GET` (best-effort; keeps state on failure). */
  reconcile: (id: string) => Promise<void>;
  /** Set the connection status (driven by a realtime hook, best-effort). */
  setConnectionStatus: (status: ConnectionStatus) => void;
  /** Reset to the initial state. */
  reset: () => void;
}

export type CompletionStore = CompletionStoreState & CompletionStoreActions;

const initialState: CompletionStoreState = {
  completion: null,
  connectionStatus: 'disconnected',
  error: null,
  isSubmitting: false,
};

/** Apply an optimistic terminal state (idempotent, never regresses an already-terminal completion). */
function applyOptimisticState(
  completion: ServiceCompletion,
  next: CompletionState,
): ServiceCompletion {
  if (TERMINAL_STATES.includes(completion.state)) {
    return completion;
  }
  return { ...completion, state: next };
}

export const useCompletionStore = create<CompletionStore>((set, get) => ({
  ...initialState,

  loadCompletion: async (id) => {
    set({ error: null });
    try {
      const completion = await getCompletionRequest(id);
      set({ completion });
    } catch {
      set({ error: COMPLETION_I18N_KEYS.LOAD_ERROR });
    }
  },

  confirm: async (id) => {
    const { completion } = get();
    if (completion) {
      set({ completion: applyOptimisticState(completion, 'CONFIRMED') });
    }
    await runAction(set, () => confirmCompletionRequest(id));
    await get().reconcile(id);
  },

  dispute: async (id) => {
    const { completion } = get();
    if (completion) {
      set({ completion: applyOptimisticState(completion, 'DISPUTED') });
    }
    await runAction(set, () => disputeCompletionRequest(id));
    await get().reconcile(id);
  },

  postReleaseDispute: async (id) => {
    await runAction(set, () => postReleaseDisputeRequest(id));
    await get().reconcile(id);
  },

  submitRating: async (id, stars, comment) => {
    await runAction(set, () => submitRatingRequest(id, stars, comment));
    await get().reconcile(id);
  },

  reconcile: async (id) => {
    try {
      const completion = await getCompletionRequest(id);
      set({ completion });
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

/** Run a mutating action guarding `isSubmitting` and surfacing an i18n error key on failure. */
async function runAction(
  set: (partial: Partial<CompletionStoreState>) => void,
  action: () => Promise<void>,
): Promise<void> {
  set({ error: null, isSubmitting: true });
  try {
    await action();
  } catch {
    set({ error: COMPLETION_I18N_KEYS.ACTION_ERROR });
  } finally {
    set({ isSubmitting: false });
  }
}

/** Convenience hook returning the full completion store. */
export function useCompletion(): CompletionStore {
  return useCompletionStore();
}

export default useCompletion;
