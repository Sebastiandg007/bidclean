/**
 * checklist-photos domain types + error strings (Spec 19).
 *
 * Internal contracts for run creation off the durable `service_started` event, task marking, the
 * grant/finalize/playback photo flow, and run finalize/abandon. Photo bytes and object keys are
 * treated as sensitive: neither is ever embedded in an error message or log line — only
 * structural/authorization/lifecycle facts appear here.
 */

/** Run lifecycle states (VARCHAR + app validation, never a PG enum). */
export const ChecklistRunState = {
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  ABANDONED: 'ABANDONED',
} as const;
export type ChecklistRunState = (typeof ChecklistRunState)[keyof typeof ChecklistRunState];

/** Terminal run states: immutable audit facts once reached. */
export const TERMINAL_RUN_STATES: readonly ChecklistRunState[] = [
  ChecklistRunState.COMPLETED,
  ChecklistRunState.ABANDONED,
];

/** Whether a run state is terminal (immutable). */
export function isTerminalRunState(state: string): state is ChecklistRunState {
  return (TERMINAL_RUN_STATES as readonly string[]).includes(state);
}

/** Photo evidence kind (VARCHAR + app validation). */
export const TaskPhotoKind = {
  BEFORE: 'BEFORE',
  AFTER: 'AFTER',
  GENERAL: 'GENERAL',
} as const;
export type TaskPhotoKind = (typeof TaskPhotoKind)[keyof typeof TaskPhotoKind];

/** Whether a raw string is a valid photo kind. */
export function isTaskPhotoKind(value: string): value is TaskPhotoKind {
  return value === TaskPhotoKind.BEFORE || value === TaskPhotoKind.AFTER || value === TaskPhotoKind.GENERAL;
}

/** Upload-grant lifecycle. `ISSUED` reserves a slot; `CONSUMED` on finalize; swept → EXPIRED/CANCELLED. */
export const GrantStatus = {
  ISSUED: 'ISSUED',
  CONSUMED: 'CONSUMED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type GrantStatus = (typeof GrantStatus)[keyof typeof GrantStatus];

/** Tombstone lifecycle: PENDING (awaiting MinIO removal) | DONE (object removed). */
export const ObjectDeletionStatus = { PENDING: 'PENDING', DONE: 'DONE' } as const;
export type ObjectDeletionStatus =
  (typeof ObjectDeletionStatus)[keyof typeof ObjectDeletionStatus];

/** Reason a run reached ABANDONED (app-validated). */
export const AbandonReason = {
  OFFER_TERMINAL: 'OFFER_TERMINAL',
  SESSION_TERMINAL: 'SESSION_TERMINAL',
} as const;
export type AbandonReason = (typeof AbandonReason)[keyof typeof AbandonReason];

/** Task-level photo-required policy, frozen on the run at creation. */
export type PhotoRequiredPolicy = 'NONE' | 'ALL_TASKS';

/** Run-level completion precondition, frozen on the run at creation. */
export type CompletionPrecondition = 'NONE' | 'ALL_TASKS_DONE' | 'ALL_REQUIRED_PHOTOS';

/** The completion event type emitted into `checklist_outbox`. */
export const CHECKLIST_COMPLETED_EVENT_TYPE = 'checklist_completed';

/** The outbox table + aggregate type owned by checklist-photos. */
export const CHECKLIST_OUTBOX_TABLE = 'checklist_outbox';
export const CHECKLIST_AGGREGATE_TYPE = 'checklist_run';

/**
 * The policy snapshot carried on the `service_started` event (captured as-of IN_PROGRESS by
 * Spec 17). Copied verbatim onto the run so tasks + policies share one temporal frontier.
 */
export interface ChecklistPolicySnapshot {
  readonly photoRequiredPolicy: PhotoRequiredPolicy;
  readonly completionPrecondition: CompletionPrecondition;
  readonly maxPhotosPerTask: number;
}

/**
 * The event-carried checklist + policy snapshot the started-consumer reads to create a run. All
 * fields are captured in Spec 17's IN_PROGRESS transaction; the run is built from these, never a
 * live property/config read.
 */
export interface StartedPayload {
  readonly sessionId: string;
  readonly offerId: string;
  readonly propertyId: string | null;
  readonly hostId: string | null;
  readonly cleanerId: string | null;
  /** The property's `checklistItems` as-of IN_PROGRESS (ordered). May be empty. */
  readonly checklistItems: readonly string[];
  readonly photoRequiredPolicy: PhotoRequiredPolicy;
  readonly completionPrecondition: CompletionPrecondition;
  readonly maxPhotosPerTask: number;
}

/** The client-facing run view (reconciliation read). Never carries an object key or bytes. */
export interface ChecklistRunView {
  readonly id: string;
  readonly serviceSessionId: string;
  readonly state: ChecklistRunState;
  readonly totalTasks: number;
  readonly completedTasks: number;
  readonly maxPhotosPerTask: number;
  readonly tasks: readonly ChecklistTaskView[];
}

/** The client-facing task view. `photos` are references (ids), never object keys/URLs. */
export interface ChecklistTaskView {
  readonly id: string;
  readonly position: number;
  readonly taskText: string;
  readonly isDone: boolean;
  readonly completedAt: string | null;
  readonly photos: readonly TaskPhotoRef[];
}

/** A photo reference exposed to the client (id + kind + when), never the object key. */
export interface TaskPhotoRef {
  readonly id: string;
  readonly kind: TaskPhotoKind;
  readonly uploadedAt: string;
}

/** Result of issuing an upload target: the opaque key + a short-lived pre-signed PUT URL. */
export interface UploadTarget {
  readonly objectKey: string;
  readonly uploadUrl: string;
  readonly expiresAt: string;
}

/** Result of a playback request: a short-lived pre-signed GET URL (raw key never exposed). */
export interface PlaybackTarget {
  readonly playbackUrl: string;
  readonly expiresAt: string;
}

/**
 * Server-observed (authoritative) properties of a stored photo object. `exists=false` means the
 * object is missing; `width/height=null` means dimensions could not be probed as a valid image.
 */
export interface InspectResult {
  readonly exists: boolean;
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly width: number | null;
  readonly height: number | null;
}

/** The durable summary emitted on finalize (payload of `checklist_completed`). No PII, no bytes. */
export interface CompletionSummary {
  readonly runId: string;
  readonly serviceSessionId: string;
  readonly totalTasks: number;
  readonly completedTasks: number;
  readonly photoCount: number;
  /**
   * The run's durable, server-authoritative finish time (`checklist_runs.completed_at`, stamped in
   * the SAME transaction as `ACTIVE → COMPLETED`), as an ISO-8601 string. Additive, backward-safe
   * extension (Spec 20): downstream consumers that ignore it are unaffected. service-completion
   * anchors its auto-release deadline to this authoritative finish time — never a consume time.
   */
  readonly completedAt: string;
}

/**
 * checklist-photos error messages.
 *
 * Non-sensitive, structural/authorization/lifecycle strings only. Object keys and photo bytes are
 * NEVER embedded here or in any thrown error, so no sensitive content leaks into logs or responses.
 */
export const CHECKLIST_ERROR_MESSAGES = {
  /** The referenced run/session does not exist (or the caller may not learn it does). */
  RUN_NOT_FOUND: 'Checklist run not found',
  /** The referenced task does not exist within the run. */
  TASK_NOT_FOUND: 'Checklist task not found',
  /** The referenced photo does not belong to this session (session-scoped playback lookup). */
  PHOTO_NOT_FOUND: 'Checklist photo not found',
  /** The caller is not one of the session's two participants. */
  NOT_A_PARTICIPANT: 'Not a participant of this service session',
  /** The action requires the Cleaner role on the session. */
  NOT_THE_CLEANER: 'Only the assigned cleaner may perform this action',
  /** The mutation/upload is not allowed because the run is not ACTIVE / session not in window. */
  RUN_NOT_ACTIVE: 'The checklist run is not open for this action',
  /** No valid upload grant for the referenced key (missing/wrong user/wrong run-task). */
  GRANT_NOT_FOUND: 'No valid upload grant for this photo',
  /** The grant was already consumed, expired, or closed. */
  GRANT_UNUSABLE: 'This upload grant is no longer usable',
  /** The per-task photo cap has been reached. */
  PHOTO_CAP_REACHED: 'The maximum number of photos for this task has been reached',
  /** The referenced photo object does not exist in storage. */
  OBJECT_MISSING: 'The uploaded photo object was not found',
  /** The photo object could not be validated as a permitted image type. */
  OBJECT_INVALID_TYPE: 'The uploaded object is not a permitted image type',
  /** The photo object exceeds the configured maximum size. */
  OBJECT_TOO_LARGE: 'The uploaded photo exceeds the maximum allowed size',
  /** The photo object could not be probed for image dimensions. */
  OBJECT_UNPROBEABLE: 'The uploaded photo could not be read as a valid image',
  /** The completion precondition (snapshotted) is not met. */
  PRECONDITION_UNMET: 'The checklist cannot be finalized until its completion requirements are met',
  /** The authenticated Keycloak subject does not resolve to a BidClean user. */
  USER_NOT_FOUND: 'User not found',
} as const;
