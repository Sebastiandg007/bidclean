/**
 * checklist.types — Mobile domain types for checklist-photos (Spec 19).
 *
 * Mirrors the backend `checklist-photos` contracts (run view + task + photo refs). Photo bytes
 * never reach the store; only references (ids/kind/uploadedAt) are held. The Cleaner marks tasks and
 * uploads evidence; the Host observes progress and views evidence (participant-gated). The store
 * never persists a bare object key.
 */

/** Run lifecycle state (server-authoritative). */
export type ChecklistRunState = 'ACTIVE' | 'COMPLETED' | 'ABANDONED';

/** Evidence kind. */
export type TaskPhotoKind = 'BEFORE' | 'AFTER' | 'GENERAL';

/** WebSocket/best-effort connection status surfaced to the UI. */
export type ConnectionStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';

/** A photo reference (never a key or URL — playback URLs are fetched on demand). */
export interface TaskPhotoRef {
  readonly id: string;
  readonly kind: TaskPhotoKind;
  readonly uploadedAt: string;
}

/** A checklist task (snapshot text + completion + attached evidence refs). */
export interface ChecklistTask {
  readonly id: string;
  readonly position: number;
  readonly taskText: string;
  readonly isDone: boolean;
  readonly completedAt: string | null;
  readonly photos: readonly TaskPhotoRef[];
}

/** The client-facing run view (matches the backend `ChecklistRunView`). */
export interface ChecklistRun {
  readonly id: string;
  readonly serviceSessionId: string;
  readonly state: ChecklistRunState;
  readonly totalTasks: number;
  readonly completedTasks: number;
  readonly maxPhotosPerTask: number;
  readonly tasks: readonly ChecklistTask[];
}

/** The pre-signed upload target returned by request-upload. */
export interface UploadTarget {
  readonly objectKey: string;
  readonly uploadUrl: string;
  readonly expiresAt: string;
}

/** The pre-signed playback target returned by playback-url. */
export interface PlaybackTarget {
  readonly playbackUrl: string;
  readonly expiresAt: string;
}

/** A captured photo asset from the picker/camera (client-side, pre-upload). */
export interface CapturedPhoto {
  readonly uri: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly width: number | null;
  readonly height: number | null;
}
