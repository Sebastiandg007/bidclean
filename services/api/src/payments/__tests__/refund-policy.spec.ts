import { decideRefund, computeProportionalReversal } from '../refund-policy';
import { DisputeStatus, PaymentStatus, PayoutStatus } from '../payments.types';

describe('refund-policy', () => {
  const base = {
    hostTotalCents: 11000, // $110 charged to host (100 + 10% fee)
    cleanerPayoutCents: 9700, // $97 payout (100 - 3%)
    alreadyRefundedCents: 0,
    alreadyReversedCents: 0,
  };

  describe('pre-release', () => {
    it('refunds only, no reversal, when HELD and payout not yet transferred', () => {
      const decision = decideRefund({
        ...base,
        paymentStatus: PaymentStatus.HELD,
        payoutStatus: PayoutStatus.NOT_READY,
        disputeStatus: DisputeStatus.NONE,
        requestedAmountCents: 5000,
      });
      expect(decision.blocked).toBe(false);
      expect(decision.refundAmountCents).toBe(5000);
      expect(decision.reversalAmountCents).toBe(0);
    });

    it('defaults to the full remaining amount when no amount is requested', () => {
      const decision = decideRefund({
        ...base,
        paymentStatus: PaymentStatus.HELD,
        payoutStatus: PayoutStatus.PENDING,
        disputeStatus: DisputeStatus.NONE,
      });
      expect(decision.refundAmountCents).toBe(base.hostTotalCents);
      expect(decision.reversalAmountCents).toBe(0);
    });
  });

  describe('post-release', () => {
    it('refunds and reverses the proportional cleaner share', () => {
      const decision = decideRefund({
        ...base,
        paymentStatus: PaymentStatus.RELEASED,
        payoutStatus: PayoutStatus.PAID,
        disputeStatus: DisputeStatus.NONE,
        requestedAmountCents: 11000,
      });
      expect(decision.blocked).toBe(false);
      expect(decision.refundAmountCents).toBe(11000);
      // trunc(11000 * 9700 / 11000) = 9700
      expect(decision.reversalAmountCents).toBe(9700);
    });

    it('reverses a proportional partial amount', () => {
      const decision = decideRefund({
        ...base,
        paymentStatus: PaymentStatus.RELEASED,
        payoutStatus: PayoutStatus.TRANSFER_CREATED,
        disputeStatus: DisputeStatus.NONE,
        requestedAmountCents: 5500,
      });
      // trunc(5500 * 9700 / 11000) = trunc(4850) = 4850
      expect(decision.reversalAmountCents).toBe(4850);
    });
  });

  describe('blocking conditions', () => {
    it('blocks when a dispute is open', () => {
      const decision = decideRefund({
        ...base,
        paymentStatus: PaymentStatus.HELD,
        payoutStatus: PayoutStatus.NOT_READY,
        disputeStatus: DisputeStatus.OPEN,
        requestedAmountCents: 100,
      });
      expect(decision.blocked).toBe(true);
      expect(decision.reason).toContain('dispute');
    });

    it('blocks when the refund exceeds the ceiling (P7)', () => {
      const decision = decideRefund({
        ...base,
        paymentStatus: PaymentStatus.HELD,
        payoutStatus: PayoutStatus.NOT_READY,
        disputeStatus: DisputeStatus.NONE,
        requestedAmountCents: base.hostTotalCents + 1,
      });
      expect(decision.blocked).toBe(true);
    });

    it('blocks a second refund that would exceed the remaining refundable', () => {
      const decision = decideRefund({
        ...base,
        alreadyRefundedCents: 10000,
        paymentStatus: PaymentStatus.PARTIALLY_REFUNDED,
        payoutStatus: PayoutStatus.NOT_READY,
        disputeStatus: DisputeStatus.NONE,
        requestedAmountCents: 2000, // remaining is only 1000
      });
      expect(decision.blocked).toBe(true);
    });

    it('blocks non-refundable payment states', () => {
      const decision = decideRefund({
        ...base,
        paymentStatus: PaymentStatus.PENDING,
        payoutStatus: PayoutStatus.NOT_READY,
        disputeStatus: DisputeStatus.NONE,
        requestedAmountCents: 100,
      });
      expect(decision.blocked).toBe(true);
    });

    it('rejects a non-positive requested amount', () => {
      const decision = decideRefund({
        ...base,
        paymentStatus: PaymentStatus.HELD,
        payoutStatus: PayoutStatus.NOT_READY,
        disputeStatus: DisputeStatus.NONE,
        requestedAmountCents: 0,
      });
      expect(decision.blocked).toBe(true);
    });
  });

  describe('computeProportionalReversal', () => {
    it('is integer-only and never exceeds the cleaner payout', () => {
      expect(computeProportionalReversal(11000, 11000, 9700)).toBe(9700);
      expect(computeProportionalReversal(1, 11000, 9700)).toBe(0); // trunc(0.88..) = 0
      expect(computeProportionalReversal(11000, 0, 9700)).toBe(0); // guard against div-by-zero
      expect(Number.isInteger(computeProportionalReversal(7333, 11000, 9700))).toBe(true);
    });
  });
});
