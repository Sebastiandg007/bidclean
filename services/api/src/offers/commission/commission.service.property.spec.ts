import * as fc from 'fast-check';
import { CommissionService } from './commission.service';

/**
 * Property-based tests for the CommissionService.
 *
 * Feature: offer-publishing
 *
 * Validates commission calculation invariants hold across all valid inputs
 * using integer-only arithmetic with Math.trunc.
 */
describe('CommissionService — Property-Based Tests', () => {
  let service: CommissionService;

  beforeEach(() => {
    service = new CommissionService();
  });

  // Feature: offer-publishing, Property 9.1: Host Commission Calculation Invariant
  /**
   * Validates: Requirements 1.2
   *
   * Generates random positive integers 1–100_000_000 for price and
   * random rates 1–10000 bps, asserts:
   * - fee === Math.trunc(price * rate / 10000)
   * - total === price + fee
   * - fee >= 0 (non-negative)
   * - total > price (strictly greater since rate > 0)
   * - All values are integers
   */
  describe('Property 9.1: Host Commission Calculation Invariant', () => {
    it('fee = trunc(price * rate / 10000), total = price + fee, all positive integers', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100_000_000 }),
          fc.integer({ min: 1, max: 10000 }),
          (priceCents: number, rateBps: number) => {
            const result = service.calculateHostFee({ priceCents, rateBps });
            const expectedFee = Math.trunc((priceCents * rateBps) / 10000);
            const total = priceCents + result.amountCents;

            // fee matches formula
            expect(result.amountCents).toBe(expectedFee);

            // total is price + fee
            expect(total).toBe(priceCents + expectedFee);

            // fee is non-negative
            expect(result.amountCents).toBeGreaterThanOrEqual(0);

            // total is strictly greater than or equal to price
            expect(total).toBeGreaterThanOrEqual(priceCents);

            // All values are integers
            expect(Number.isInteger(result.amountCents)).toBe(true);
            expect(Number.isInteger(total)).toBe(true);
            expect(Number.isInteger(result.rateBps)).toBe(true);
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  // Feature: offer-publishing, Property 9.2: Cleaner Commission Calculation Invariant
  /**
   * Validates: Requirements 1.2
   *
   * Generates random positive integers 1–100_000_000 for price and
   * random rates 1–9999 bps (strictly less than 10000 to guarantee payout > 0),
   * asserts:
   * - commission === Math.trunc(price * rate / 10000)
   * - payout === price - commission
   * - payout < price (since commission > 0 for rate > 0 and price large enough)
   * - payout >= 0 (never negative — guaranteed when rate < 10000)
   * - All values are integers
   */
  describe('Property 9.2: Cleaner Commission Calculation Invariant', () => {
    it('commission = trunc(price * rate / 10000), payout = price - commission, payout non-negative', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100_000_000 }),
          fc.integer({ min: 1, max: 9999 }),
          (priceCents: number, rateBps: number) => {
            const result = service.calculateCleanerCommission({ priceCents, rateBps });
            const expectedCommission = Math.trunc((priceCents * rateBps) / 10000);
            const payout = priceCents - result.amountCents;

            // commission matches formula
            expect(result.amountCents).toBe(expectedCommission);

            // payout is price - commission
            expect(payout).toBe(priceCents - expectedCommission);

            // payout is less than or equal to price (commission >= 0)
            expect(payout).toBeLessThanOrEqual(priceCents);

            // payout is non-negative (rate < 10000 guarantees commission < price)
            expect(payout).toBeGreaterThanOrEqual(0);

            // All values are integers
            expect(Number.isInteger(result.amountCents)).toBe(true);
            expect(Number.isInteger(payout)).toBe(true);
            expect(Number.isInteger(result.rateBps)).toBe(true);
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});
