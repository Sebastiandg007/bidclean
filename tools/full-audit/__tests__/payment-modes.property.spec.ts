/**
 * Property 8 + unit tests for the payment-mode policy.
 */

import fc from 'fast-check';
import {
  assertAutomaticModeAllowed,
  isAutomaticModeAllowed,
  LiveMoneyNotAutomaticError,
  type PaymentMode,
} from '../payment/payment-modes';

const RUNS = { numRuns: 200 };
const ALL_MODES: readonly PaymentMode[] = ['sandbox', 'live-readiness', 'operator-live-money'];

describe('payment-mode policy — property-based', () => {
  // Feature: full-audit, Property 8: For any automatic-audit invocation of an external-payment edge,
  // the payment-mode policy permits only sandbox or live-readiness (non-transacting) and refuses
  // operator-live-money; a real live-money transaction is only reachable through an explicit,
  // operator-gated action outside the automatic audit. No automatic path selects operator-live-money.
  it('Property 8: the automatic audit can never move real money', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_MODES), (mode) => {
        const allowed = isAutomaticModeAllowed(mode);
        if (mode === 'operator-live-money') {
          expect(allowed).toBe(false);
          expect(() => assertAutomaticModeAllowed(mode)).toThrow(LiveMoneyNotAutomaticError);
        } else {
          expect(allowed).toBe(true);
          expect(() => assertAutomaticModeAllowed(mode)).not.toThrow();
        }
      }),
      RUNS,
    );
  });
});

describe('payment-mode policy — examples', () => {
  it('permits sandbox and live-readiness', () => {
    expect(() => assertAutomaticModeAllowed('sandbox')).not.toThrow();
    expect(() => assertAutomaticModeAllowed('live-readiness')).not.toThrow();
  });

  it('throws on operator-live-money', () => {
    expect(() => assertAutomaticModeAllowed('operator-live-money')).toThrow(
      LiveMoneyNotAutomaticError,
    );
  });
});
