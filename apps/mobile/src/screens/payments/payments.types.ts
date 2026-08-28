/**
 * Payments types — mobile-side interfaces for the Stripe escrow flow.
 *
 * Mirrors the backend payment view. Prices are integer cents; the UI formats them
 * per locale + offer currency. The server is authoritative — the client never makes
 * payment decisions.
 */

/** Financial lifecycle of a payment */
export type PaymentStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'HELD'
  | 'RELEASED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | 'FAILED';

/** Dispute lifecycle (orthogonal) */
export type DisputeStatus = 'NONE' | 'OPEN' | 'WON' | 'LOST';

/** Payout lifecycle (orthogonal) */
export type PayoutStatus = 'NOT_READY' | 'PENDING' | 'TRANSFER_CREATED' | 'PAID' | 'REVERSED';

/** Monetary breakdown surfaced to the client (integer cents) */
export interface PaymentBreakdown {
  agreedPriceCents: number;
  hostTotalCents: number;
  cleanerPayoutCents: number;
  platformGrossRevenueCents: number;
  stripeFeeCents: number;
  netPlatformRevenueCents: number;
  refundedAmountCents: number;
  reversedAmountCents: number;
  currency: string;
}

/** Combined payment view (payment + dispute + payout + breakdown) */
export interface PaymentView {
  id: string;
  offerId: string;
  paymentStatus: PaymentStatus;
  disputeStatus: DisputeStatus;
  payoutStatus: PayoutStatus;
  breakdown: PaymentBreakdown;
  heldAt: string | null;
  releasedAt: string | null;
  createdAt: string;
}

/** Cleaner Stripe Connected Account status (no secrets) */
export interface StripeAccountStatus {
  hasAccount: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  country: string | null;
  defaultCurrency: string | null;
}

/** Onboarding link response */
export interface OnboardingResult {
  onboardingUrl: string;
}

/** Result of a refund request */
export interface RefundResult {
  success: boolean;
  /** i18n error key when success is false */
  errorKey?: string;
  payment?: PaymentView;
}
