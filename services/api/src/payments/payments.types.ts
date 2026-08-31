/**
 * Payments domain types.
 *
 * Enums for the three orthogonal lifecycles (payment / dispute / payout), the
 * attempt lifecycle, and release reasons; plus internal view/summary types.
 * All monetary values are integers (cents).
 */

/** Financial lifecycle of a payment */
export enum PaymentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  HELD = 'HELD',
  RELEASED = 'RELEASED',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  FAILED = 'FAILED',
}

/** Dispute lifecycle (orthogonal to PaymentStatus) */
export enum DisputeStatus {
  NONE = 'NONE',
  OPEN = 'OPEN',
  WON = 'WON',
  LOST = 'LOST',
}

/** Payout lifecycle (orthogonal to PaymentStatus) */
export enum PayoutStatus {
  NOT_READY = 'NOT_READY',
  PENDING = 'PENDING',
  TRANSFER_CREATED = 'TRANSFER_CREATED',
  PAID = 'PAID',
  REVERSED = 'REVERSED',
}

/** Charge attempt lifecycle */
export enum AttemptStatus {
  PROCESSING = 'PROCESSING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
}

/** Why a release was triggered */
export enum ReleaseReason {
  HOST_CONFIRMED = 'HOST_CONFIRMED',
  AUTO_RELEASE = 'AUTO_RELEASE',
  DEFERRED_ONBOARDING = 'DEFERRED_ONBOARDING',
}

/** Event source for the payment_events ledger */
export enum PaymentEventSource {
  API = 'api',
  WEBHOOK = 'webhook',
}

/** Role-scoped monetary breakdown surfaced to the client */
export interface PaymentBreakdownView {
  readonly agreedPriceCents: number;
  readonly hostTotalCents: number;
  readonly cleanerPayoutCents: number;
  readonly platformGrossRevenueCents: number;
  readonly stripeFeeCents: number;
  readonly netPlatformRevenueCents: number;
  readonly refundedAmountCents: number;
  readonly reversedAmountCents: number;
  readonly currency: string;
}

/** Combined payment view (payment + dispute + payout + breakdown) */
export interface PaymentView {
  readonly id: string;
  readonly offerId: string;
  readonly paymentStatus: PaymentStatus;
  readonly disputeStatus: DisputeStatus;
  readonly payoutStatus: PayoutStatus;
  readonly breakdown: PaymentBreakdownView;
  readonly heldAt: string | null;
  readonly releasedAt: string | null;
  readonly createdAt: string;
}

/** Stripe Connected Account capability status (no secrets) */
export interface StripeAccountStatus {
  readonly hasAccount: boolean;
  readonly chargesEnabled: boolean;
  readonly payoutsEnabled: boolean;
  readonly detailsSubmitted: boolean;
  readonly country: string | null;
  readonly defaultCurrency: string | null;
}

/** Decision produced by the pure refund policy */
export interface RefundDecision {
  /** Amount to refund to the Host in cents */
  readonly refundAmountCents: number;
  /** Amount to reverse from the Cleaner's transfer in cents (post-release) */
  readonly reversalAmountCents: number;
  /** Whether the refund is blocked (e.g. dispute open) */
  readonly blocked: boolean;
  /** Human-readable reason when blocked or for audit */
  readonly reason?: string;
}
