import { OutboxRow } from '../common/outbox/outbox-writer';

/**
 * Payments domain-owned outbox shaping. The deterministic `event_id` derivation and the minimal
 * payload (ids only — no amounts, currencies, or instruments) live inside the payments bounded
 * context. The notifications `payment.*` mapper consumes this exact payload shape.
 */

/** The physical outbox table owned by the payments bounded context. */
export const PAYMENT_OUTBOX_TABLE = 'payment_outbox';

/** The aggregate kind for payment outbox rows (app-validated short code). */
export const PAYMENT_AGGREGATE_TYPE = 'payment';

/** The payment notification-worthy facts (mirrors the notifications `payment.*` types). */
export const PaymentOutboxEventType = {
  CAPTURED: 'payment.captured',
  RELEASED: 'payment.released',
  FAILED: 'payment.failed',
  REFUNDED: 'payment.refunded',
  DISPUTED: 'payment.disputed',
} as const;

export type PaymentOutboxEventType =
  (typeof PaymentOutboxEventType)[keyof typeof PaymentOutboxEventType];

/** Ids the payment outbox row carries so the mapper can build the intent for the right recipient. */
export interface PaymentOutboxParams {
  readonly paymentId: string;
  readonly recipientUserId: string;
  readonly type: PaymentOutboxEventType;
}

/**
 * Build a `payment_outbox` row for a money-state fact. The `event_id` is deterministic per
 * (payment, event, recipient) — `payment:<paymentId>:<type>:<recipientUserId>` — so a redelivery
 * derives the same ledger dedup key (exactly-once intent). Written in the SAME transaction as the
 * payment state change.
 */
export function buildPaymentOutboxRow(params: PaymentOutboxParams): OutboxRow {
  return {
    eventId: `${PAYMENT_AGGREGATE_TYPE}:${params.paymentId}:${params.type}:${params.recipientUserId}`,
    aggregateType: PAYMENT_AGGREGATE_TYPE,
    aggregateId: params.paymentId,
    type: params.type,
    payload: {
      recipientUserId: params.recipientUserId,
      paymentId: params.paymentId,
    },
    tableName: PAYMENT_OUTBOX_TABLE,
  };
}