/**
 * checklist.store — Zustand store for checklist-photos (one store per domain, Spec 19).
 *
 * Holds the authoritative run + tasks + photo refs (from `GET`) and a best-effort connection
 * status. Task toggles + attached evidence are applied optimistically and reconciled via `GET`;
 * state application is idempotent and never regresses a terminal run. The store NEVER persists a
 * bare object key — only photo references (ids). Errors surface as i18n key strings.
 */

import { create } from 'zustand';

import {
  finalizeChecklistRequest,
  getChecklistRequest,
  markTaskRequest,
  uploadTaskPhotoRequest,
} from './checklist.api';
import { CHECKLIST_I18N_KEYS } from './checklist.constants';
import type {
  CapturedPhoto,
  ChecklistRun,
  ChecklistRunState,
  ConnectionStatus,
  TaskPhotoKind,
} from './checklist.types';

/** Terminal run states never accept a regressing update. */
const TERMINAL_STATES: readonly ChecklistRunState[] = ['COMPLETED', 'ABANDONED'];

export interface ChecklistState {
  run: ChecklistRun | null;
  connectionStatus: ConnectionStatus;
  error: string | null;
  isFinalizing: boolean;
}

export interface ChecklistActions {
  /** Load (or reload) the authoritative run via `GET`. */
  loadChecklist: (sessionId: string) => Promise<void>;
  /** Cleaner toggles a task; optimistic, then reconciled via `GET`. */
  toggleTask: (sessionId: string, taskId: string, done: boolean) => Promise<void>;
  /** Cleaner uploads evidence for a task (request → PUT → finalize), then reconciles. */
  uploadPhoto: (
    sessionId: string,
    taskId: string,
    photo: CapturedPhoto,
    kind: TaskPhotoKind,
  ) => Promise<void>;
  /** Cleaner finalizes the checklist; on success reflects COMPLETED. */
  finalize: (sessionId: string) => Promise<void>;
  /** Reconcile the authoritative run via `GET` (best-effort; keeps state on failure). */
  reconcile: (sessionId: string) => Promise<void>;
  /** Set the connection status (driven by a realtime hook, best-effort). */
  setConnectionStatus: (status: ConnectionStatus) => void;
  /** Reset to the initial state. */
  reset: () => void;
}

export type ChecklistStore = ChecklistState & ChecklistActions;

const initialState: ChecklistState = {
  run: null,
  connectionStatus: 'disconnected',
  error: null,
  isFinalizing: false,
};

/** Apply an optimistic task toggle to the in-memory run (idempotent, never mutates a terminal run). */
function applyToggle(run: ChecklistRun, taskId: string, done: boolean): ChecklistRun {
  if (TERMINAL_STATES.includes(run.state)) {
    return run;
  }
  const tasks = run.tasks.map((task) =>
    task.id === taskId ? { ...task, isDone: done } : task,
  );
  return { ...run, tasks, completedTasks: tasks.filter((task) => task.isDone).length };
}

export const useChecklistStore = create<ChecklistStore>((set, get) => ({
  ...initialState,

  loadChecklist: async (sessionId) => {
    set({ error: null });
    try {
      const run = await getChecklistRequest(sessionId);
      set({ run });
    } catch {
      set({ error: CHECKLIST_I18N_KEYS.LOAD_ERROR });
    }
  },

  toggleTask: async (sessionId, taskId, done) => {
    const { run } = get();
    if (run) {
      set({ run: applyToggle(run, taskId, done) }); // optimistic
    }
    try {
      await markTaskRequest(sessionId, taskId, done);
    } catch {
      set({ error: CHECKLIST_I18N_KEYS.LOAD_ERROR });
    }
    await get().reconcile(sessionId);
  },

  uploadPhoto: async (sessionId, taskId, photo, kind) => {
    set({ error: null });
    try {
      await uploadTaskPhotoRequest(sessionId, taskId, photo, kind);
    } catch {
      set({ error: CHECKLIST_I18N_KEYS.PHOTO_CAP_REACHED });
    }
    await get().reconcile(sessionId);
  },

  finalize: async (sessionId) => {
    set({ error: null, isFinalizing: true });
    try {
      await finalizeChecklistRequest(sessionId);
      await get().reconcile(sessionId);
    } catch {
      set({ error: CHECKLIST_I18N_KEYS.FINALIZE_BLOCKED });
    } finally {
      set({ isFinalizing: false });
    }
  },

  reconcile: async (sessionId) => {
    try {
      const run = await getChecklistRequest(sessionId);
      set({ run });
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

/** Convenience hook returning the full checklist store. */
export function useChecklist(): ChecklistStore {
  return useChecklistStore();
}

export default useChecklist;
