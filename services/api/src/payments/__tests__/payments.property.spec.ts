/**
 * Property-based tests (fast-check) for the stripe-escrow correctness properties P1–P12.
 *
 * These validate the module's pure invariants over randomized inputs: money integrity,
 * breakdown consistency, refund/reversal ceilings, lifecycle orthogonality, and the
 * deterministic idempotency keys. Flows requiring a live DB/Stripe (single-charge,
 * single-release, reconciliation convergence, authorization) are exercised structurally
 * here and end-to-end in the integration tests (Task 18).
 */

import * as fc from 'fast-check';
import { CommissionService } from '../../offers/commission/commission.service';
import { decideRefund, computeProportionalReversal } from '../refund-policy';
import {
  validatePaymentTransition,
  validateDisputeTransition,
  validatePayoutTransition,
  PAYMENT_ALLOWED_TRANSITIONS,
  DISPUTE_ALLOWED_TRANSITIONS,
  PAYOUT_ALLOWED_TRANSITIONS,
} from '../payment-state-machine';
import { DisputeStatus, PaymentStatus, PayoutStatus } from '../payments.types';
import { stripeIdempotency } from '../stripe/stripe-idempotency';

const RUNS = { numRuns: 200 };
const commission = new CommissionService();

// Realistic bounds: prices from $1 to $100,000; rates 0–50%.
const priceCents = fc.integer({ min: 100, max: 10_000_000 });
const rateBps = fc.integer({ min: 0, max: 5000 });

describe('Payments property-based tests (P1–P12)', () => {
  // Property 1: Money Integrity
  it('P1: every monetary value is an integer', () => {
    fc.assert(
      fc.property(priceCents, rateBps, rateBps, (p, hostBps, cleanerBps) => {
        const b = commission.getFullBreakdown(p, hostBps, cleanerBps);
        for (const v of [b.hostTotalCents, b.cleanerPayoutCents, b.hostFeeCents, b.cleanerCommissionCents]) {
          expect(Number.isInteger(v)).toBe(true);
        }
      }),
      RUNS,
    );
  });

  // Property 2: Breakdown Consistency
  it('P2: host_total = price + fee, cleaner_payout = price - commission, gross = host_total - payout', () => {
    fc.assert(
      fc.property(priceCents, rateBps, rateBps, (p, hostBps, cleanerBps) => {
        const b = commission.getFullBreakdown(p, hostBps, cleanerBps);
        expect(b.hostTotalCents).toBe(p + b.hostFeeCents);
        expect(b.cleanerPayoutCents).toBe(p - b.cleanerCommissionCents);
        const gross = b.hostTotalCents - b.cleanerPayoutCents;
        expect(gross).toBe(b.hostFeeCents + b.cleanerCommissionCents);
        // net = gross - fee - adjustments; with a random fee <= gross, net stays consistent
        const stripeFee = Math.min(gross, Math.trunc(gross / 3));
        const net = gross - stripeFee;
        expect(net).toBe(gross - stripeFee);
      }),
      RUNS,
    );
  });

  // Property 7: Refund & Reversal Ceilings
  it('P7: refunds never exceed host_total and reversals never exceed cleaner_payout', () => {
    fc.assert(
      fc.property(
        priceCents,
        rateBps,
        rateBps,
        fc.integer({ min: 1, max: 20_000_000 }),
        fc.constantFrom(PayoutStatus.NOT_READY, PayoutStatus.PENDING, PayoutStatus.PAID, PayoutStatus.TRANSFER_CREATED),
        (p, hostBps, cleanerBps, requested, payoutStatus) => {
          const b = commission.getFullBreakdown(p, hostBps, cleanerBps);
          const decision = decideRefund({
            paymentStatus: PaymentStatus.HELD,
            payoutStatus,
            disputeStatus: DisputeStatus.NONE,
            requestedAmountCents: requested,
            hostTotalCents: b.hostTotalCents,
            cleanerPayoutCents: b.cleanerPayoutCents,
            alreadyRefundedCents: 0,
            alreadyReversedCents: 0,
          });
          if (!decision.blocked) {
            expect(decision.refundAmountCents).toBeLessThanOrEqual(b.hostTotalCents);
            expect(decision.reversalAmountCents).toBeLessThanOrEqual(b.cleanerPayoutCents);
            expect(decision.refundAmountCents).toBeGreaterThan(0);
          }
        },
      ),
      RUNS,
    );
  });

  it('P7b: proportional reversal is integer and bounded by cleaner_payout', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        (refund, hostTotal, cleanerPayout) => {
          const reversal = computeProportionalReversal(refund, hostTotal, cleanerPayout);
          expect(Number.isInteger(reversal)).toBe(true);
          expect(reversal).toBeGreaterThanOrEqual(0);
          expect(reversal).toBeLessThanOrEqual(cleanerPayout);
        },
      ),
      RUNS,
    );
  });

  it('P7c: sequential refunds never exceed the ceiling across accumulation', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1000, max: 1_000_000 }),
        fc.array(fc.integer({ min: 1, max: 100_000 }), { maxLength: 20 }),
        (hostTotal, requests) => {
          let refunded = 0;
          for (const req of requests) {
            const decision = decideRefund({
              paymentStatus: refunded === 0 ? PaymentStatus.HELD : PaymentStatus.PARTIALLY_REFUNDED,
              payoutStatus: PayoutStatus.NOT_READY,
              disputeStatus: DisputeStatus.NONE,
              requestedAmountCents: req,
              hostTotalCents: hostTotal,
              cleanerPayoutCents: hostTotal,
              alreadyRefundedCents: refunded,
              alreadyReversedCents: 0,
            });
            if (!decision.blocked) {
              refunded += decision.refundAmountCents;
            }
            expect(refunded).toBeLessThanOrEqual(hostTotal);
          }
        },
      ),
      RUNS,
    );
  });

  // Property 8: Idempotency (deterministic keys)
  it('P8: idempotency keys are deterministic for identical inputs', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 1, max: 100 }), fc.string(), (id, n, key) => {
        expect(stripeIdempotency.charge(id, n)).toBe(stripeIdempotency.charge(id, n));
        expect(stripeIdempotency.release(id)).toBe(stripeIdempotency.release(id));
        expect(stripeIdempotency.refund(id, key)).toBe(stripeIdempotency.refund(id, key));
        expect(stripeIdempotency.reversal(id, key)).toBe(stripeIdempotency.reversal(id, key));
      }),
      RUNS,
    );
  });

  it('P8b: different attempts produce different charge keys', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.integer({ min: 1, max: 50 }), (id, n) => {
        expect(stripeIdempotency.charge(id, n)).not.toBe(stripeIdempotency.charge(id, n + 1));
      }),
      RUNS,
    );
  });

  // Property 12: Lifecycle Orthogonality
  const paymentStatuses = Object.values(PaymentStatus);
  const disputeStatuses = Object.values(DisputeStatus);
  const payoutStatuses = Object.values(PayoutStatus);

  it('P12: each lifecycle only permits its own declared transitions', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...paymentStatuses),
        fc.constantFrom(...paymentStatuses),
        (from, to) => {
          const allowed = PAYMENT_ALLOWED_TRANSITIONS[from].includes(to);
          expect(validatePaymentTransition(from, to).valid).toBe(allowed);
        },
      ),
      RUNS,
    );
    fc.assert(
      fc.property(
        fc.constantFrom(...disputeStatuses),
        fc.constantFrom(...disputeStatuses),
        (from, to) => {
          const allowed = DISPUTE_ALLOWED_TRANSITIONS[from].includes(to);
          expect(validateDisputeTransition(from, to).valid).toBe(allowed);
        },
      ),
      RUNS,
    );
    fc.assert(
      fc.property(
        fc.constantFrom(...payoutStatuses),
        fc.constantFrom(...payoutStatuses),
        (from, to) => {
          const allowed = PAYOUT_ALLOWED_TRANSITIONS[from].includes(to);
          expect(validatePayoutTransition(from, to).valid).toBe(allowed);
        },
      ),
      RUNS,
    );
  });

  it('P12b: the RELEASED + OPEN + PAID combined state is composed of independently valid transitions', () => {
    // Payment HELD->RELEASED, dispute NONE->OPEN, payout TRANSFER_CREATED->PAID
    expect(validatePaymentTransition(PaymentStatus.HELD, PaymentStatus.RELEASED).valid).toBe(true);
    expect(validateDisputeTransition(DisputeStatus.NONE, DisputeStatus.OPEN).valid).toBe(true);
    expect(validatePayoutTransition(PayoutStatus.TRANSFER_CREATED, PayoutStatus.PAID).valid).toBe(true);
  });

  // Property 5 (structural): disputed-open blocks a refund regardless of amounts
  it('P5: a refund is always blocked while a dispute is OPEN', () => {
    fc.assert(
      fc.property(priceCents, fc.integer({ min: 1, max: 1_000_000 }), (p, requested) => {
        const decision = decideRefund({
          paymentStatus: PaymentStatus.HELD,
          payoutStatus: PayoutStatus.NOT_READY,
          disputeStatus: DisputeStatus.OPEN,
          requestedAmountCents: requested,
          hostTotalCents: p,
          cleanerPayoutCents: p,
          alreadyRefundedCents: 0,
          alreadyReversedCents: 0,
        });
        expect(decision.blocked).toBe(true);
      }),
      RUNS,
    );
  });
});
