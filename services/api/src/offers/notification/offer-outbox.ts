import { OutboxRow } from '../../common/outbox/outbox-writer';

/**
 * Offers domain-owned outbox shaping. The deterministic `event_id` derivation and the minimal
 * payload (ids only) live inside the offers bounded context. The notifications `offer.*` mapper
 * consumes this exact payload shape and reproduces the legacy offer-radar new-offer push
 * (behavior-preserving — REQ-NP13).
 */

/** The physical outbox table owned by the offers bounded context. */
export const OFFER_OUTBOX_TABLE = 'offer_outbox';

/** The aggregate kind for offer outbox rows (app-validated short code). */
export const OFFER_AGGREGATE_TYPE = 'offer';

/**
 * The offer notification-worthy facts (mirror the notifications `offer.*` types). The new-offer
 * radar push preserved by Task 12 is `offer.matched` (the type the legacy mapper reproduces).
 */
export const OfferOutboxEventType = {
  MATCHED: 'offer.matched',
  CANCELLED: 'offer.cancelled',
  EXPIRED: 'offer.expired',
  COMPLETED: 'offer.completed',
} as const;

export type OfferOutboxEventType =
  (typeof OfferOutboxEventType)[keyof typeof OfferOutboxEventType];

/** Ids an offer outbox row carries so the mapper can build the intent for the right recipient. */
export interface OfferOutboxParams {
  readonly offerId: string;
  readonly recipientUserId: string;
  readonly type: OfferOutboxEventType;
}

/**
 * Build an `offer_outbox` row for an offer fact. The `event_id` is deterministic per
 * (offer, event, recipient) — `offer:<offerId>:<type>:<recipientUserId>` — so a redelivery derives
 * the same ledger dedup key (exactly-once intent) and the new-offer push is never duplicated for a
 * given Cleaner. Written in the SAME transaction as the write that supersedes the direct push.
 */
export function buildOfferOutboxRow(params: OfferOutboxParams): OutboxRow {
  return {
    eventId: `${OFFER_AGGREGATE_TYPE}:${params.offerId}:${params.type}:${params.recipientUserId}`,
    aggregateType: OFFER_AGGREGATE_TYPE,
    aggregateId: params.offerId,
    type: params.type,
    payload: {
      recipientUserId: params.recipientUserId,
      offerId: params.offerId,
    },
    tableName: OFFER_OUTBOX_TABLE,
  };
}