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
} as const;
export type ServiceOutboxConsumer =
  (typeof ServiceOutboxConsumer)[keyof typeof ServiceOutboxConsumer];

/** Ids shared by every service-tracking transition event. */
export interface ServiceOutboxBaseParams {
  readonly sessionId: string;
  readonly offerId: string;
  readonly cleanerId: string | null;
  readonly hostId: string | null;
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

/** Build the `service_started` outbox row (hand-off point to Specs 18/19/20). */
export function buildStartedOutboxRow(params: ServiceOutboxBaseParams): OutboxRow {
  return baseRow(ServiceOutboxEventType.STARTED, params, {});
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
      ...extra,
    },
    tableName: SERVICE_OUTBOX_TABLE,
  };
}
