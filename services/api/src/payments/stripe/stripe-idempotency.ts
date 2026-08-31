/**
 * Deterministic Stripe idempotency-key builders.
 *
 * Keys are derived from stable identifiers so a replay of the same logical operation
 * carries the same key, making the Stripe call a no-op beyond the first (Property P8).
 * Every key produced here is persisted in `payment_events.idempotency_key` for audit.
 */
export const stripeIdempotency = {
  /** Charge attempt N for an offer (P3 + retry) */
  charge: (offerId: string, attempt: number): string => `charge:${offerId}:${attempt}`,
  /** Payout release Transfer for a payment (P4) */
  release: (paymentId: string): string => `release:${paymentId}`,
  /** Refund for a payment, scoped by a caller-provided key */
  refund: (paymentId: string, key: string): string => `refund:${paymentId}:${key}`,
  /** Transfer Reversal for a payment, scoped by a caller-provided key */
  reversal: (paymentId: string, key: string): string => `reversal:${paymentId}:${key}`,
} as const;
