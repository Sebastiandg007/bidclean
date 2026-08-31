/**
 * Payment domain events (EventEmitter2).
 *
 * The payments module emits these; downstream consumers (offer-publishing,
 * notifications, service-tracking, analytics, dispute-system) react. Notably,
 * offer-publishing consumes `payment.failed` to decide the offer's next state —
 * this module never writes the offers table.
 */
export const PAYMENT_EVENT_NAMES = {
  CAPTURED: 'payment.captured',
  RELEASED: 'payment.released',
  FAILED: 'payment.failed',
  REFUNDED: 'payment.refunded',
  DISPUTED: 'payment.disputed',
} as const;

/** Union of valid payment event name strings */
export type PaymentEventName = (typeof PAYMENT_EVENT_NAMES)[keyof typeof PAYMENT_EVENT_NAMES];

/** Base payload shared by all payment domain events */
export interface PaymentEventBase {
  readonly paymentId: string;
  readonly offerId: string;
  readonly hostId: string;
  readonly cleanerId: string;
  readonly timestamp: Date;
}

/** Emitted when the Host is charged and funds are held in escrow */
export interface PaymentCapturedEvent extends PaymentEventBase {
  readonly type: typeof PAYMENT_EVENT_NAMES.CAPTURED;
  readonly hostTotalCents: number;
  readonly currency: string;
}

/** Emitted when the payout Transfer to the Cleaner is created */
export interface PaymentReleasedEvent extends PaymentEventBase {
  readonly type: typeof PAYMENT_EVENT_NAMES.RELEASED;
  readonly cleanerPayoutCents: number;
  readonly currency: string;
}

/** Emitted when a charge fails (offer-publishing decides the offer next state) */
export interface PaymentFailedEvent extends PaymentEventBase {
  readonly type: typeof PAYMENT_EVENT_NAMES.FAILED;
  readonly failureReason: string;
}

/** Emitted when a refund (and any reversal) is applied */
export interface PaymentRefundedEvent extends PaymentEventBase {
  readonly type: typeof PAYMENT_EVENT_NAMES.REFUNDED;
  readonly refundAmountCents: number;
  readonly reversalAmountCents: number;
  readonly currency: string;
}

/** Emitted when a dispute is opened on the payment */
export interface PaymentDisputedEvent extends PaymentEventBase {
  readonly type: typeof PAYMENT_EVENT_NAMES.DISPUTED;
}
