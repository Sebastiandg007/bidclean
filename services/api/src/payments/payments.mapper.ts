import { Payment } from './entities/payment.entity';
import {
  DisputeStatus,
  PaymentStatus,
  PaymentView,
  PayoutStatus,
} from './payments.types';

/**
 * Map a Payment entity to the client-facing PaymentView (payment + dispute + payout
 * status plus a monetary breakdown). Timestamps are serialized to ISO strings.
 */
export function toPaymentView(payment: Payment): PaymentView {
  return {
    id: payment.id,
    offerId: payment.offerId,
    paymentStatus: payment.paymentStatus as PaymentStatus,
    disputeStatus: payment.disputeStatus as DisputeStatus,
    payoutStatus: payment.payoutStatus as PayoutStatus,
    breakdown: {
      agreedPriceCents: payment.agreedPriceCents,
      hostTotalCents: payment.hostTotalCents,
      cleanerPayoutCents: payment.cleanerPayoutCents,
      platformGrossRevenueCents: payment.platformGrossRevenueCents,
      stripeFeeCents: payment.stripeFeeCents,
      netPlatformRevenueCents: payment.netPlatformRevenueCents,
      refundedAmountCents: payment.refundedAmountCents,
      reversedAmountCents: payment.reversedAmountCents,
      currency: payment.currency,
    },
    heldAt: payment.heldAt ? payment.heldAt.toISOString() : null,
    releasedAt: payment.releasedAt ? payment.releasedAt.toISOString() : null,
    createdAt: payment.createdAt.toISOString(),
  };
}
