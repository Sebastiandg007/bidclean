import { DisputeStatus, PaymentStatus, PayoutStatus } from '../payments.types';

/** Monetary breakdown returned to the client (integer cents) */
export interface PaymentBreakdownResponse {
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

/** Payment status response (payment + dispute + payout + breakdown) */
export interface PaymentResponseDto {
  readonly id: string;
  readonly offerId: string;
  readonly paymentStatus: PaymentStatus;
  readonly disputeStatus: DisputeStatus;
  readonly payoutStatus: PayoutStatus;
  readonly breakdown: PaymentBreakdownResponse;
  readonly heldAt: string | null;
  readonly releasedAt: string | null;
  readonly createdAt: string;
}
