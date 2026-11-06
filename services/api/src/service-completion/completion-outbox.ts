import { OutboxRow } from '../common/outbox/outbox-writer';
import {
  COMPLETION_AGGREGATE_TYPE,
  COMPLETION_OUTBOX_TABLE,
} from './completion.constants';
import {
  CompletionOutboxEventType,
  CompletionReleaseReason,
  RatingRole,
} from './completion.types';

/**
 * service-completion outbox row shaping for the durable transition events
 * (`service_confirmed` / `service_disputed` / `service_rated`).
 *
 * Each row is written in the SAME transaction as its transition. `completion_outbox` carries no
 * shared `relayed_at`; it is a fan-out source drained per-consumer downstream. Payloads are
 * ids/enums/routing fields only — never a payment secret or PII.
 */

/** Build the `service_confirmed` row (deterministic `service_confirmed:<completionId>`). */
export function buildConfirmedOutboxRow(
  completionId: string,
  offerId: string,
  trigger: CompletionReleaseReason,
): OutboxRow {
  return {
    eventId: `${CompletionOutboxEventType.CONFIRMED}:${completionId}`,
    aggregateType: COMPLETION_AGGREGATE_TYPE,
    aggregateId: completionId,
    type: CompletionOutboxEventType.CONFIRMED,
    payload: { completionId, offerId, trigger },
    tableName: COMPLETION_OUTBOX_TABLE,
  };
}

/** Build the `service_disputed` row (deterministic `service_disputed:<completionId>:<disputeId>`). */
export function buildDisputedOutboxRow(
  completionId: string,
  offerId: string,
  disputeId: string,
): OutboxRow {
  return {
    eventId: `${CompletionOutboxEventType.DISPUTED}:${completionId}:${disputeId}`,
    aggregateType: COMPLETION_AGGREGATE_TYPE,
    aggregateId: completionId,
    type: CompletionOutboxEventType.DISPUTED,
    payload: { completionId, offerId, disputeId },
    tableName: COMPLETION_OUTBOX_TABLE,
  };
}

/** Build the `service_rated` row (deterministic `service_rated:<completionId>:<role>`). */
export function buildRatedOutboxRow(
  completionId: string,
  role: RatingRole,
  stars: number,
): OutboxRow {
  return {
    eventId: `${CompletionOutboxEventType.RATED}:${completionId}:${role}`,
    aggregateType: COMPLETION_AGGREGATE_TYPE,
    aggregateId: completionId,
    type: CompletionOutboxEventType.RATED,
    payload: { completionId, role, stars },
    tableName: COMPLETION_OUTBOX_TABLE,
  };
}
