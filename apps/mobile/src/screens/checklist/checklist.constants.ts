/**
 * checklist.constants — Mobile config, endpoints, i18n keys, and design tokens for checklist-photos.
 *
 * Endpoints mirror the backend `service-sessions/:id/checklist` controller. The only client tunable
 * is the UX max-size pre-check via `EXPO_PUBLIC_CHECKLIST_PHOTO_MAX_SIZE_BYTES` (the server is
 * authoritative). No secret and nothing security-sensitive is hardcoded here.
 */

/** Backend REST endpoints for checklist-photos (nested under a service session). */
export const CHECKLIST_ENDPOINTS = {
  checklist: (sessionId: string): string => `/service-sessions/${sessionId}/checklist`,
  markTask: (sessionId: string, taskId: string): string =>
    `/service-sessions/${sessionId}/checklist/tasks/${taskId}`,
  requestUpload: (sessionId: string, taskId: string): string =>
    `/service-sessions/${sessionId}/checklist/tasks/${taskId}/photo/request-upload`,
  finalizePhoto: (sessionId: string, taskId: string): string =>
    `/service-sessions/${sessionId}/checklist/tasks/${taskId}/photo/finalize`,
  playbackUrl: (sessionId: string, photoId: string): string =>
    `/service-sessions/${sessionId}/checklist/photos/${photoId}/playback-url`,
  finalize: (sessionId: string): string => `/service-sessions/${sessionId}/checklist/finalize`,
} as const;

/** Navigation route names for the checklist screens (mounted in both role stacks). */
export const CHECKLIST_SCREEN_ROUTE = 'Checklist';
export const CHECKLIST_PROGRESS_SCREEN_ROUTE = 'ChecklistProgress';

/**
 * Client-side max photo size (bytes) — a UX pre-check ONLY. The server independently inspects and
 * enforces the authoritative limit; this just avoids an obviously-too-large upload.
 */
export const CHECKLIST_PHOTO_MAX_SIZE_BYTES = parseInt(
  process.env.EXPO_PUBLIC_CHECKLIST_PHOTO_MAX_SIZE_BYTES ?? '10485760',
  10,
);

/** BidClean dark design tokens used by the checklist screens. */
export const CHECKLIST_COLORS = {
  ACCENT: '#00F5D4',
  CARD: '#1F2833',
  BACKGROUND: '#0B0C10',
  TEXT: '#FFFFFF',
  TEXT_SECONDARY: '#C5C6C7',
} as const;

/** i18n keys for the checklist UI (en/es in parity). */
export const CHECKLIST_I18N_KEYS = {
  CLEANER_TITLE: 'checklist.cleaner.title',
  HOST_TITLE: 'checklist.host.title',
  PROGRESS: 'checklist.progress',
  MARK_DONE: 'checklist.task.markDone',
  MARK_UNDONE: 'checklist.task.markUndone',
  ADD_PHOTO: 'checklist.task.addPhoto',
  VIEW_EVIDENCE: 'checklist.task.viewEvidence',
  CAPTURE_BEFORE: 'checklist.capture.before',
  CAPTURE_AFTER: 'checklist.capture.after',
  PERMISSION_DENIED: 'checklist.capture.permissionDenied',
  PERMISSION_EXPLAINER: 'checklist.capture.permissionExplainer',
  PHOTO_TOO_LARGE: 'checklist.capture.tooLarge',
  FINALIZE: 'checklist.finalize.action',
  FINALIZE_BLOCKED: 'checklist.finalize.blocked',
  FINALIZE_MISSING_TASKS: 'checklist.finalize.missingTasks',
  FINALIZE_MISSING_PHOTOS: 'checklist.finalize.missingPhotos',
  COMPLETED: 'checklist.state.completed',
  ABANDONED: 'checklist.state.abandoned',
  EMPTY: 'checklist.empty',
  LOAD_ERROR: 'checklist.loadError',
  PHOTO_CAP_REACHED: 'checklist.capture.capReached',
} as const;
