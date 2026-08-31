import { stripeIdempotency } from '../stripe/stripe-idempotency';

describe('stripeIdempotency', () => {
  it('builds deterministic charge keys per offer + attempt', () => {
    expect(stripeIdempotency.charge('offer-1', 1)).toBe('charge:offer-1:1');
    expect(stripeIdempotency.charge('offer-1', 2)).toBe('charge:offer-1:2');
    // Same inputs -> same key (idempotent replay)
    expect(stripeIdempotency.charge('offer-1', 1)).toBe(stripeIdempotency.charge('offer-1', 1));
  });

  it('builds a stable release key per payment', () => {
    expect(stripeIdempotency.release('pay-1')).toBe('release:pay-1');
  });

  it('scopes refund and reversal keys by a caller key', () => {
    expect(stripeIdempotency.refund('pay-1', 'abc')).toBe('refund:pay-1:abc');
    expect(stripeIdempotency.reversal('pay-1', 'abc')).toBe('reversal:pay-1:abc');
  });
});
