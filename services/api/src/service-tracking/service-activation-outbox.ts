import { OutboxRow } from '../common/outbox/outbox-writer';
import { ActivationPayload } from './service-tracking.types';

/**
 * The `service_activation_ready` durable fact (offer MATCHED AND escrow CAPTURED).
 *
 * This is emitted UPSTREAM by the offer/escrow path (payments) in the SAME transaction as the
 * escrow HELD transition, into a dedicated `service_activation_outbox` table it writes but does
 * not drain. service-tracking is one of potentially several consumers of that upstream outbox, so
 * it drains via its OWN per-consumer checkpoint (`service_activation_consumed`) rather than
 * mutating a shared `relayed_at`.
 *
 * A DEDICATED table (not `payment_outbox`) is deliberate: the notifications relay marks every
 * `payment_outbox` row relayed even for a type its mapper does not handle, which would silently
 * drop this fact for any other consumer. Owning the table keeps the fan-out safe.
 */

/** The physical outbox table owned by the offer/escrow (activation) path. */
export const SERVICE_ACTIVATION_OUTBOX_TABLE = 'service_activation_outbox';

/** The aggregate kind for activation outbox rows (app-validated short code). */
export const SERVICE_ACTIVATION_AGGREGATE_TYPE = 'service_activation';

/** The single activation fact type. */
export const SERVICE_ACTIVATION_EVENT_TYPE = 'service_activation_ready';

/**
 * Build the `service_activation_outbox` row for a matched+charged offer. The `event_id` is
 * deterministic per offer (`service_activation_ready:<offerId>`) so a redelivery derives the same
 * dedup key and session creation stays idempotent (backed by `UNIQUE offer_id` on the session).
 * Written in the SAME transaction as the escrow HELD transition.
 */
export function buildServiceActivationOutboxRow(payload: ActivationPayload): OutboxRow {
  return {
    eventId: `${SERVICE_ACTIVATION_EVENT_TYPE}:${payload.offerId}`,
    aggregateType: SERVICE_ACTIVATION_AGGREGATE_TYPE,
    aggregateId: payload.offerId,
    type: SERVICE_ACTIVATION_EVENT_TYPE,
    payload: {
      offerId: payload.offerId,
      hostId: payload.hostId,
      cleanerId: payload.cleanerId,
      propertyId: payload.propertyId,
    },
    tableName: SERVICE_ACTIVATION_OUTBOX_TABLE,
  };
}
