import { OutboxRow } from '../common/outbox/outbox-writer';
import { ServiceOutboxEventType } from './service-tracking.types';

/**
 * service-tracking domain-owned outbox shaping for the durable state-transition events
 * (`service_en_route` / `service_arrived` / `service_started`).
 *
 * Each row is written in the SAME transaction as its single-winner state transition. The
 * `service_outbox` table carries NO shared `relayed_at`; instead it is a fan-out source drained
 * independently by each downstream consumer (Spec 16 notifications, Spec 18 video) via
 * `service_outbox_consumers` keyed by `(event_id, consumer_name)`. Payloads are ids only — never a
 * coordinate stream, never PII.
 */

/** The physical outbox table owned by service-tracking. */
export const SERVICE_OUTBOX_TABLE = 'service_outbox';

/** The aggregate kind for service-tracking outbox rows (app-validated short code). */
export const SERVICE_AGGREGATE_TYPE = 'service_session';

/** The known downstream consumer names that drain `service_outbox` independently. */
export const ServiceOutboxConsumer = {
  NOTIFICATIONS: 'notifications',
  VIDEO: 'video',
  CHECKLIST: 'checklist',
} as const;
export type ServiceOutboxConsumer =
  (typeof ServiceOutboxConsumer)[keyof typeof ServiceOutboxConsumer];

/** Ids shared by every service-tracking transition event. */
export interface ServiceOutboxBaseParams {
  readonly sessionId: string;
  readonly offerId: string;
  readonly cleanerId: string | null;
  readonly hostId: string | null;
  /**
   * The session's property id (optional, additive). Carried on the payload so downstream consumers
   * (e.g. checklist-photos) can bind to the property without a second lookup; omitting it keeps the
   * historical payload shape unchanged.
   */
  readonly propertyId?: string | null;
}

/** Build the `service_en_route` outbox row (deterministic `service_en_route:<sessionId>`). */
export function buildEnRouteOutboxRow(params: ServiceOutboxBaseParams): OutboxRow {
  return baseRow(ServiceOutboxEventType.EN_ROUTE, params, {});
}

/** Build the `service_arrived` outbox row; adds the durable `arrivalDistanceM` scalar. */
export function buildArrivedOutboxRow(
  params: ServiceOutboxBaseParams,
  arrivalDistanceM: number,
): OutboxRow {
  return baseRow(ServiceOutboxEventType.ARRIVED, params, { arrivalDistanceM });
}

/**
 * The optional checklist + policy snapshot carried on `service_started` (Spec 19, additive).
 *
 * Captured as-of IN_PROGRESS in the same transition transaction that captured the start fact, so
 * checklist-photos can build a run with a single temporal frontier (checklist + policies both
 * as-of IN_PROGRESS) without re-reading the live property or live config at consume time. This is a
 * one-directional, backward-safe extension: a consumer that ignores these fields is unaffected, the
 * existing ids-only consumers (Spec 16 notifications, Spec 18 video) are untouched, and the
 * deterministic `service_started:<sessionId>` event id is unchanged.
 */
export interface StartedChecklistSnapshot {
  /** The property's `checklistItems` as-of IN_PROGRESS (ordered; may be empty). */
  readonly checklistItems: readonly string[];
  /** Task-level photo-required policy as-of IN_PROGRESS. */
  readonly photoRequiredPolicy: string;
  /** Run-level completion precondition as-of IN_PROGRESS. */
  readonly completionPrecondition: string;
  /** Max photos per task as-of IN_PROGRESS. */
  readonly maxPhotosPerTask: number;
}

/**
 * Build the `service_started` outbox row (hand-off point to Specs 18/19/20).
 *
 * When a `snapshot` is supplied it is spread additively into the payload (mirrors how
 * `buildArrivedOutboxRow` adds `arrivalDistanceM`) so checklist-photos gets the checklist + policy
 * snapshot as-of IN_PROGRESS. Omitting it keeps the historical ids-only payload — the extension is
 * backward-safe and never changes the event id or the existing keys.
 */
export function buildStartedOutboxRow(
  params: ServiceOutboxBaseParams,
  snapshot?: StartedChecklistSnapshot,
): OutboxRow {
  const extra: Record<string, unknown> = snapshot
    ? {
        checklistItems: snapshot.checklistItems,
        photoRequiredPolicy: snapshot.photoRequiredPolicy,
        completionPrecondition: snapshot.completionPrecondition,
        maxPhotosPerTask: snapshot.maxPhotosPerTask,
      }
    : {};
  return baseRow(ServiceOutboxEventType.STARTED, params, extra);
}

/** Shared row shaping: deterministic `<type>:<sessionId>` event id, ids-only payload. */
function baseRow(
  type: ServiceOutboxEventType,
  params: ServiceOutboxBaseParams,
  extra: Readonly<Record<string, unknown>>,
): OutboxRow {
  return {
    eventId: `${type}:${params.sessionId}`,
    aggregateType: SERVICE_AGGREGATE_TYPE,
    aggregateId: params.sessionId,
    type,
    payload: {
      sessionId: params.sessionId,
      offerId: params.offerId,
      cleanerId: params.cleanerId,
      hostId: params.hostId,
      ...(params.propertyId !== undefined ? { propertyId: params.propertyId } : {}),
      ...extra,
    },
    tableName: SERVICE_OUTBOX_TABLE,
  };
}
