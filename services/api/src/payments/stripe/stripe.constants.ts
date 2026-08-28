/**
 * Stripe-specific constants: webhook event names this module dispatches on.
 * The pinned API version lives in `payments.constants.ts` (STRIPE_API_VERSION).
 */
export const STRIPE_WEBHOOK_EVENTS = {
  PAYMENT_INTENT_SUCCEEDED: 'payment_intent.succeeded',
  PAYMENT_INTENT_FAILED: 'payment_intent.payment_failed',
  CHARGE_REFUNDED: 'charge.refunded',
  TRANSFER_CREATED: 'transfer.created',
  TRANSFER_PAID: 'transfer.paid',
  TRANSFER_REVERSED: 'transfer.reversed',
  DISPUTE_CREATED: 'charge.dispute.created',
  DISPUTE_CLOSED: 'charge.dispute.closed',
  ACCOUNT_UPDATED: 'account.updated',
} as const;

/** Union of the Stripe webhook event names this module handles */
export type StripeWebhookEventName =
  (typeof STRIPE_WEBHOOK_EVENTS)[keyof typeof STRIPE_WEBHOOK_EVENTS];
