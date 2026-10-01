import { OutboxRow } from '../../common/outbox/outbox-writer';

/**
 * VOIP domain-owned outbox shaping. Keeps the deterministic `event_id` derivation and the
 * minimal payload (ids only) inside the voip bounded context — the shared writer stays
 * domain-agnostic and the notifications `voip.*` mapper consumes this exact payload shape.
 */

/** The physical outbox table owned by the voip bounded context. */
export const VOIP_OUTBOX_TABLE = 'voip_outbox';

/** The aggregate kind for voip outbox rows (app-validated short code). */
export const VOIP_AGGREGATE_TYPE = 'call';

/** The single voip notification-worthy fact: a call reaching RINGING. */
export const VOIP_EVENT_TYPE_CALL_INVITED = 'call-invited';

/** Ids the voip `call-invited` outbox row carries so the mapper can build an incoming-call intent. */
export interface CallInvitedOutboxParams {
  readonly callId: string;
  readonly conversationId: string;
  readonly recipientUserId: string;
}

/**
 * Build the `voip_outbox` row for a fresh RINGING call. The `event_id` is deterministic per call
 * (`call:<callId>:call-invited`) so a redelivery/retry derives the same ledger dedup key
 * (exactly-once intent). Written in the SAME transaction as the RINGING insert.
 */
export function buildCallInvitedOutboxRow(params: CallInvitedOutboxParams): OutboxRow {
  return {
    eventId: `${VOIP_AGGREGATE_TYPE}:${params.callId}:${VOIP_EVENT_TYPE_CALL_INVITED}`,
    aggregateType: VOIP_AGGREGATE_TYPE,
    aggregateId: params.callId,
    type: VOIP_EVENT_TYPE_CALL_INVITED,
    payload: {
      recipientUserId: params.recipientUserId,
      callId: params.callId,
      conversationId: params.conversationId,
    },
    tableName: VOIP_OUTBOX_TABLE,
  };
}