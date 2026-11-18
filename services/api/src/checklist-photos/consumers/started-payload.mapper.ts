import {
  CHECKLIST_COMPLETION_PRECONDITION,
  CHECKLIST_PHOTO_MAX_PER_TASK,
  CHECKLIST_PHOTO_REQUIRED_POLICY,
  isCompletionPrecondition,
  isPhotoRequiredPolicy,
} from '../checklist.constants';
import {
  CompletionPrecondition,
  PhotoRequiredPolicy,
  StartedPayload,
} from '../checklist.types';

/**
 * Map an untrusted `service_started` JSONB payload into a typed {@link StartedPayload}.
 *
 * The event carries the checklist snapshot + policy snapshots captured as-of IN_PROGRESS (Spec 17,
 * additive extension). This mapper reads those event-carried values — never live config or a live
 * property read. When the event predates the additive extension (a field is absent), the policy
 * falls back to the module's configured default so an older event still creates a valid run; the
 * checklist snapshot falls back to an empty list (a zero-task run is valid). Values are validated so
 * a malformed field never poisons the run.
 */
export function toStartedPayload(payload: Record<string, unknown>): StartedPayload {
  return {
    sessionId: requireString(payload.sessionId),
    offerId: requireString(payload.offerId),
    propertyId: optionalString(payload.propertyId),
    hostId: optionalString(payload.hostId),
    cleanerId: optionalString(payload.cleanerId),
    checklistItems: toStringArray(payload.checklistItems),
    photoRequiredPolicy: toPhotoRequiredPolicy(payload.photoRequiredPolicy),
    completionPrecondition: toCompletionPrecondition(payload.completionPrecondition),
    maxPhotosPerTask: toMaxPhotos(payload.maxPhotosPerTask),
  };
}

/** Require a string field (throws so a malformed event is re-drainable, never a corrupt run). */
function requireString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('service_started payload missing a required id');
  }
  return value;
}

/** An optional string id (null when absent/blank). */
function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Coerce the event-carried checklist snapshot to an ordered string array (empty when absent). */
function toStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

/** Event-carried photo-required policy, else the configured default. */
function toPhotoRequiredPolicy(value: unknown): PhotoRequiredPolicy {
  if (typeof value === 'string' && isPhotoRequiredPolicy(value)) {
    return value;
  }
  return isPhotoRequiredPolicy(CHECKLIST_PHOTO_REQUIRED_POLICY)
    ? CHECKLIST_PHOTO_REQUIRED_POLICY
    : 'NONE';
}

/** Event-carried completion precondition, else the configured default. */
function toCompletionPrecondition(value: unknown): CompletionPrecondition {
  if (typeof value === 'string' && isCompletionPrecondition(value)) {
    return value;
  }
  return isCompletionPrecondition(CHECKLIST_COMPLETION_PRECONDITION)
    ? CHECKLIST_COMPLETION_PRECONDITION
    : 'NONE';
}

/** Event-carried max-photos-per-task, else the configured default. */
function toMaxPhotos(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  return CHECKLIST_PHOTO_MAX_PER_TASK;
}
