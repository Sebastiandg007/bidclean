import { OutboxRow } from '../common/outbox/outbox-writer';

import { DISPUTE_AGGREGATE_TYPE, DISPUTE_OUTBOX_TABLE } from './dispute.constants';
import { DisputeOutboxEventType } from './dispute.types';

/**
 * dispute-system outbox row shaping for the durable lifecycle events (`dispute_opened` /
 * `dispute_resolved`). Each row is written in the SAME transaction as its transition; the payload is
 * ids/enums only (never a payment secret or PII). `event_id` is deterministic per transition.
 */

/** Build the `dispute_opened` row (deterministic `dispute_opened:<disputeId>`). */
export function buildDisputeOpenedOutboxRow(
  disputeId: string,
  offerId: string,
  phase: string,
): OutboxRow {
  return {
    eventId: `${DisputeOutboxEventType.OPENED}:${disputeId}`,
    aggregateType: DISPUTE_AGGREGATE_TYPE,
    aggregateId: disputeId,
    type: DisputeOutboxEventType.OPENED,
    payload: { disputeId, offerId, phase },
    tableName: DISPUTE_OUTBOX_TABLE,
  };
}

/** Build the `dispute_resolved` row (deterministic `dispute_resolved:<disputeId>`). */
export function buildDisputeResolvedOutboxRow(
  disputeId: string,
  offerId: string,
  resolution: string,
): OutboxRow {
  return {
    eventId: `${DisputeOutboxEventType.RESOLVED}:${disputeId}`,
    aggregateType: DISPUTE_AGGREGATE_TYPE,
    aggregateId: disputeId,
    type: DisputeOutboxEventType.RESOLVED,
    payload: { disputeId, offerId, resolution },
    tableName: DISPUTE_OUTBOX_TABLE,
  };
}
