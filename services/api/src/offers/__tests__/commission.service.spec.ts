import { CommissionService } from '../commission/commission.service';
import {
  OFFER_HOST_FEE_RATE_BPS,
  OFFER_CLEANER_RATE_BPS,
} from '../offers.constants';

/**
 * CommissionService unit tests.
 *
 * Validates integer-only arithmetic, truncation, and input validation.
 */
describe('CommissionService', () => {
  let service: CommissionService;

  beforeEach(() => {
    service = new CommissionService();
  });

  describe('calculateHostFee', () => {
    it('should calculate fee using integer arithmetic with default rate', () => {
      const result = service.calculateHostFee({ priceCents: 5000 });

      // 5000 * 1000 / 10000 = 500
      expect(result.amountCents).toBe(500);
      expect(result.rateBps).toBe(OFFER_HOST_FEE_RATE_BPS);
    });

    it('should truncate fractional cents (no rounding up)', () => {
      // 333 * 1000 / 10000 = 33.3 → trunc → 33
      const result = service.calculateHostFee({ priceCents: 333 });

      expect(result.amountCents).toBe(33);
    });

    it('should handle small amounts without negative results', () => {
      // 1 * 1000 / 10000 = 0.1 → trunc → 0
      const result = service.calculateHostFee({ priceCents: 1 });

      expect(result.amountCents).toBe(0);
      expect(result.amountCents).toBeGreaterThanOrEqual(0);
    });

    it('should use custom rate when provided', () => {
      const result = service.calculateHostFee({ priceCents: 10000, rateBps: 500 });

      // 10000 * 500 / 10000 = 500
      expect(result.amountCents).toBe(500);
      expect(result.rateBps).toBe(500);
    });

    it('should throw when priceCents is zero', () => {
      expect(() => service.calculateHostFee({ priceCents: 0 })).toThrow(
        'priceCents must be a positive integer',
      );
    });

    it('should throw when priceCents is negative', () => {
      expect(() => service.calculateHostFee({ priceCents: -100 })).toThrow(
        'priceCents must be a positive integer',
      );
    });

    it('should throw when priceCents is not an integer', () => {
      expect(() => service.calculateHostFee({ priceCents: 10.5 })).toThrow(
        'priceCents must be a positive integer',
      );
    });
  });

  describe('calculateCleanerCommission', () => {
    it('should calculate commission using integer arithmetic with default rate', () => {
      const result = service.calculateCleanerCommission({ priceCents: 5000 });

      // 5000 * 300 / 10000 = 150
      expect(result.amountCents).toBe(150);
      expect(result.rateBps).toBe(OFFER_CLEANER_RATE_BPS);
    });

    it('should always produce payout less than offered price', () => {
      const result = service.calculateCleanerCommission({ priceCents: 10000 });

      // commission = trunc(10000 * 300 / 10000) = 300
      // payout = 10000 - 300 = 9700
      expect(10000 - result.amountCents).toBeLessThan(10000);
    });

    it('should truncate fractional cents', () => {
      // 77 * 300 / 10000 = 2.31 → trunc → 2
      const result = service.calculateCleanerCommission({ priceCents: 77 });

      expect(result.amountCents).toBe(2);
    });

    it('should use custom rate when provided', () => {
      const result = service.calculateCleanerCommission({ priceCents: 8000, rateBps: 250 });

      // 8000 * 250 / 10000 = 200
      expect(result.amountCents).toBe(200);
      expect(result.rateBps).toBe(250);
    });
  });

  describe('getFullBreakdown', () => {
    it('should return consistent breakdown values', () => {
      const breakdown = service.getFullBreakdown(5000);

      expect(breakdown.offeredPriceCents).toBe(5000);
      expect(breakdown.hostFeeCents).toBe(500);
      expect(breakdown.hostTotalCents).toBe(5500);
      expect(breakdown.cleanerCommissionCents).toBe(150);
      expect(breakdown.cleanerPayoutCents).toBe(4850);
      expect(breakdown.hostFeeRateBps).toBe(OFFER_HOST_FEE_RATE_BPS);
      expect(breakdown.cleanerRateBps).toBe(OFFER_CLEANER_RATE_BPS);
    });

    it('should satisfy hostTotal = offeredPrice + hostFee', () => {
      const breakdown = service.getFullBreakdown(7777);

      expect(breakdown.hostTotalCents).toBe(
        breakdown.offeredPriceCents + breakdown.hostFeeCents,
      );
    });

    it('should satisfy cleanerPayout = offeredPrice - cleanerCommission', () => {
      const breakdown = service.getFullBreakdown(7777);

      expect(breakdown.cleanerPayoutCents).toBe(
        breakdown.offeredPriceCents - breakdown.cleanerCommissionCents,
      );
    });

    it('should support custom rates', () => {
      const breakdown = service.getFullBreakdown(10000, 1500, 500);

      // Host: 10000 * 1500 / 10000 = 1500
      expect(breakdown.hostFeeCents).toBe(1500);
      expect(breakdown.hostTotalCents).toBe(11500);
      expect(breakdown.hostFeeRateBps).toBe(1500);
      // Cleaner: 10000 * 500 / 10000 = 500
      expect(breakdown.cleanerCommissionCents).toBe(500);
      expect(breakdown.cleanerPayoutCents).toBe(9500);
      expect(breakdown.cleanerRateBps).toBe(500);
    });

    it('should produce all integer values', () => {
      const breakdown = service.getFullBreakdown(3333);

      expect(Number.isInteger(breakdown.offeredPriceCents)).toBe(true);
      expect(Number.isInteger(breakdown.hostFeeCents)).toBe(true);
      expect(Number.isInteger(breakdown.hostTotalCents)).toBe(true);
      expect(Number.isInteger(breakdown.cleanerCommissionCents)).toBe(true);
      expect(Number.isInteger(breakdown.cleanerPayoutCents)).toBe(true);
    });
  });
});
