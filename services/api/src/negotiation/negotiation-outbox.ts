import { OutboxRow } from '../common/outbox/outbox-writer';

/**
 * Negotiation domain-owned outbox shaping. The deterministic `event_id` derivation and the minimal
 * payload (ids only) live inside the negotiation bounded context. The notifications
 * `negotiation.*` mapper consumes this exact payload shape (`recipientUserId` + `threadId`).
 */

/** The physical outbox table owned by the negotiation bounded context. */
export const NEGOTIATION_OUTBOX_TABLE = 'negotiation_outbox';

/** The aggregate kind for negotiation outbox rows (app-validated short code). */
export const NEGOTIATION_AGGREGATE_TYPE = 'proposal';

/** The negotiation notification-worthy facts (mirrors the notifications `negotiation_*` types). */
export const NegotiationOutboxEventType = {
  CREATED: 'negotiation_proposal_created',
  COUNTERED: 'negotiation_proposal_countered',
  REJECTED: 'negotiation_proposal_rejected',
  ACCEPTED: 'negotiation_proposal_accepted',
} as const;

export type NegotiationOutboxEventType =
  (typeof NegotiationOutboxEventType)[keyof typeof NegotiationOutboxEventType];

/** Ids a negotiation outbox row carries so the mapper can build the intent for the right recipient. */
export interface NegotiationOutboxParams {
  readonly proposalId: string;
  readonly threadId: string;
  readonly recipientUserId: string;
  readonly type: NegotiationOutboxEventType;
}

/**
 * Build a `negotiation_outbox` row for a proposal fact. The `event_id` is deterministic per
 * (proposal, event, recipient) — `proposal:<proposalId>:<type>:<recipientUserId>` — so a redelivery
 * derives the same ledger dedup key (exactly-once intent). Written in the SAME transaction as the
 * proposal state change.
 */
export function buildNegotiationOutboxRow(params: NegotiationOutboxParams): OutboxRow {
  return {
    eventId: `${NEGOTIATION_AGGREGATE_TYPE}:${params.proposalId}:${params.type}:${params.recipientUserId}`,
    aggregateType: NEGOTIATION_AGGREGATE_TYPE,
    aggregateId: params.proposalId,
    type: params.type,
    payload: {
      recipientUserId: params.recipientUserId,
      threadId: params.threadId,
    },
    tableName: NEGOTIATION_OUTBOX_TABLE,
  };
}