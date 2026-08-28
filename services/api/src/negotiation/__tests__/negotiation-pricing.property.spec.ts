import * as fc from 'fast-check';
import { NegotiationPricingService } from '../pricing/negotiation-pricing.service';
import { CommissionService } from '../../offers/commission/commission.service';
import { Offer } from '../../offers/entities/offer.entity';
import {
  NEGOTIATION_MIN_DEVIATION_BPS,
  NEGOTIATION_MAX_DEVIATION_BPS,
  BPS_DIVISOR,
} from '../negotiation.constants';

/**
 * Property-based tests for NegotiationPricingService.
 *
 * Feature: offer-negotiation
 * Validates:
 * - P2 Money Integrity (integer-only, via CommissionService)
 * - P3 Match Payout Consistency (breakdown equals CommissionService with snapshotted rates)
 * - P11 Deviation Reference Stability (bounds always relative to the Base Price)
 */
describe('NegotiationPricingService — Property-Based Tests', () => {
  let pricing: NegotiationPricingService;
  let commission: CommissionService;

  const HOST_RATE_BPS = 1000;
  const CLEANER_RATE_BPS = 300;

  beforeEach(() => {
    commission = new CommissionService();
    pricing = new NegotiationPricingService(commission);
  });

  function makeOffer(overrides: Partial<Offer> = {}): Offer {
    const offer = new Offer();
    offer.hostServiceFeeRateBps = HOST_RATE_BPS;
    offer.cleanerCommissionRateBps = CLEANER_RATE_BPS;
    offer.currency = 'USD';
    return Object.assign(offer, overrides);
  }

  describe('Property P2 + P3: breakdown equals CommissionService with snapshotted rates', () => {
    it('computeBreakdown matches getFullBreakdown for arbitrary prices and integer-only', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 100_000_000 }), (priceCents: number) => {
          const offer = makeOffer();
          const result = pricing.computeBreakdown(offer, priceCents);
          const expected = commission.getFullBreakdown(priceCents, HOST_RATE_BPS, CLEANER_RATE_BPS);

          expect(result.cleanerPayoutCents).toBe(expected.cleanerPayoutCents);
          expect(result.hostTotalCents).toBe(expected.hostTotalCents);
          expect(Number.isInteger(result.cleanerPayoutCents)).toBe(true);
          expect(Number.isInteger(result.hostTotalCents)).toBe(true);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('Property P11: deviation bounds are relative to the Base Price', () => {
    it('range is [base - trunc(base*min/1e4), base + trunc(base*max/1e4)] and inclusive', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 100_000_000 }), (basePriceCents: number) => {
          const range = pricing.getDeviationRange(basePriceCents);
          const expectedMin =
            basePriceCents - Math.trunc((basePriceCents * NEGOTIATION_MIN_DEVIATION_BPS) / BPS_DIVISOR);
          const expectedMax =
            basePriceCents + Math.trunc((basePriceCents * NEGOTIATION_MAX_DEVIATION_BPS) / BPS_DIVISOR);

          expect(range.minPriceCents).toBe(expectedMin);
          expect(range.maxPriceCents).toBe(expectedMax);

          // Inclusive edges are within bounds; just outside is not.
          expect(pricing.isWithinDeviationBounds(basePriceCents, range.minPriceCents)).toBe(true);
          expect(pricing.isWithinDeviationBounds(basePriceCents, range.maxPriceCents)).toBe(true);
          expect(pricing.isWithinDeviationBounds(basePriceCents, range.minPriceCents - 1)).toBe(false);
          expect(pricing.isWithinDeviationBounds(basePriceCents, range.maxPriceCents + 1)).toBe(false);
        }),
        { numRuns: 200 },
      );
    });

    it('the Base Price itself is always within bounds', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 100_000_000 }), (basePriceCents: number) => {
          expect(pricing.isWithinDeviationBounds(basePriceCents, basePriceCents)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  });
});
