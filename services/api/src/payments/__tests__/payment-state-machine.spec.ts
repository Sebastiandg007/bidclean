import {
  PAYMENT_ALLOWED_TRANSITIONS,
  DISPUTE_ALLOWED_TRANSITIONS,
  PAYOUT_ALLOWED_TRANSITIONS,
  validatePaymentTransition,
  validateDisputeTransition,
  validatePayoutTransition,
  isTerminalPaymentStatus,
} from '../payment-state-machine';
import { DisputeStatus, PaymentStatus, PayoutStatus } from '../payments.types';

describe('payment-state-machine', () => {
  describe('payment lifecycle', () => {
    it('allows PENDING -> PROCESSING and PENDING -> FAILED', () => {
      expect(validatePaymentTransition(PaymentStatus.PENDING, PaymentStatus.PROCESSING).valid).toBe(
        true,
      );
      expect(validatePaymentTransition(PaymentStatus.PENDING, PaymentStatus.FAILED).valid).toBe(
        true,
      );
    });

    it('allows retry FAILED -> PROCESSING (new attempt)', () => {
      expect(validatePaymentTransition(PaymentStatus.FAILED, PaymentStatus.PROCESSING).valid).toBe(
        true,
      );
    });

    it('allows post-release refunds RELEASED -> REFUNDED / PARTIALLY_REFUNDED', () => {
      expect(validatePaymentTransition(PaymentStatus.RELEASED, PaymentStatus.REFUNDED).valid).toBe(
        true,
      );
      expect(
        validatePaymentTransition(PaymentStatus.RELEASED, PaymentStatus.PARTIALLY_REFUNDED).valid,
      ).toBe(true);
    });

    it('treats REFUNDED as terminal', () => {
      expect(PAYMENT_ALLOWED_TRANSITIONS[PaymentStatus.REFUNDED]).toEqual([]);
      expect(isTerminalPaymentStatus(PaymentStatus.REFUNDED)).toBe(true);
      expect(isTerminalPaymentStatus(PaymentStatus.RELEASED)).toBe(false);
    });

    it('rejects illegal transitions with a reason', () => {
      const result = validatePaymentTransition(PaymentStatus.HELD, PaymentStatus.PROCESSING);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not allowed');
    });

    it('rejects PENDING -> HELD (must go through PROCESSING)', () => {
      expect(validatePaymentTransition(PaymentStatus.PENDING, PaymentStatus.HELD).valid).toBe(
        false,
      );
    });
  });

  describe('dispute lifecycle', () => {
    it('allows NONE -> OPEN -> WON/LOST', () => {
      expect(validateDisputeTransition(DisputeStatus.NONE, DisputeStatus.OPEN).valid).toBe(true);
      expect(validateDisputeTransition(DisputeStatus.OPEN, DisputeStatus.WON).valid).toBe(true);
      expect(validateDisputeTransition(DisputeStatus.OPEN, DisputeStatus.LOST).valid).toBe(true);
    });

    it('treats WON and LOST as terminal', () => {
      expect(DISPUTE_ALLOWED_TRANSITIONS[DisputeStatus.WON]).toEqual([]);
      expect(DISPUTE_ALLOWED_TRANSITIONS[DisputeStatus.LOST]).toEqual([]);
    });

    it('rejects NONE -> WON', () => {
      expect(validateDisputeTransition(DisputeStatus.NONE, DisputeStatus.WON).valid).toBe(false);
    });
  });

  describe('payout lifecycle', () => {
    it('allows the deferred path NOT_READY -> PENDING -> TRANSFER_CREATED', () => {
      expect(validatePayoutTransition(PayoutStatus.NOT_READY, PayoutStatus.PENDING).valid).toBe(
        true,
      );
      expect(
        validatePayoutTransition(PayoutStatus.PENDING, PayoutStatus.TRANSFER_CREATED).valid,
      ).toBe(true);
    });

    it('allows the direct path NOT_READY -> TRANSFER_CREATED', () => {
      expect(
        validatePayoutTransition(PayoutStatus.NOT_READY, PayoutStatus.TRANSFER_CREATED).valid,
      ).toBe(true);
    });

    it('allows TRANSFER_CREATED -> PAID -> REVERSED', () => {
      expect(validatePayoutTransition(PayoutStatus.TRANSFER_CREATED, PayoutStatus.PAID).valid).toBe(
        true,
      );
      expect(validatePayoutTransition(PayoutStatus.PAID, PayoutStatus.REVERSED).valid).toBe(true);
    });

    it('rejects PENDING -> PAID', () => {
      expect(validatePayoutTransition(PayoutStatus.PENDING, PayoutStatus.PAID).valid).toBe(false);
    });

    it('treats REVERSED as terminal', () => {
      expect(PAYOUT_ALLOWED_TRANSITIONS[PayoutStatus.REVERSED]).toEqual([]);
    });
  });

  describe('orthogonality (Property P12)', () => {
    it('supports the RELEASED + OPEN + PAID combined state as independently valid transitions', () => {
      // Reaching each status uses only its own machine; combined state is legal.
      expect(validatePaymentTransition(PaymentStatus.HELD, PaymentStatus.RELEASED).valid).toBe(
        true,
      );
      expect(validateDisputeTransition(DisputeStatus.NONE, DisputeStatus.OPEN).valid).toBe(true);
      expect(validatePayoutTransition(PayoutStatus.TRANSFER_CREATED, PayoutStatus.PAID).valid).toBe(
        true,
      );
    });
  });
});
