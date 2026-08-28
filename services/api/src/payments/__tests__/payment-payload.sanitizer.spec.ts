import { sanitizeStripePayload } from '../payment-payload.sanitizer';

describe('sanitizeStripePayload', () => {
  it('whitelists only safe fields from a payment_intent event', () => {
    const result = sanitizeStripePayload({
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      created: 1720000000,
      data: {
        object: {
          id: 'pi_1',
          object: 'payment_intent',
          amount: 11000,
          currency: 'usd',
          status: 'succeeded',
          // sensitive fields that must NOT survive
          client_secret: 'pi_1_secret_should_not_leak',
          customer: 'cus_123',
          payment_method: 'pm_secret',
          charges: { data: [{ payment_method_details: { card: { last4: '4242' } } }] },
        },
      },
    });

    expect(result).toEqual({
      eventId: 'evt_1',
      eventType: 'payment_intent.succeeded',
      createdAt: 1720000000,
      objectId: 'pi_1',
      objectType: 'payment_intent',
      amountCents: 11000,
      currency: 'usd',
      status: 'succeeded',
    });
  });

  it('never includes secrets, PII, or card data', () => {
    const result = sanitizeStripePayload({
      id: 'evt_2',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_1',
          object: 'charge',
          amount_refunded: 5000,
          currency: 'eur',
          client_secret: 'secret',
          billing_details: { email: 'user@example.com', phone: '+1555' },
        },
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('user@example.com');
    expect(serialized).not.toContain('+1555');
    expect(result.amountCents).toBe(5000);
  });

  it('handles missing fields gracefully', () => {
    const result = sanitizeStripePayload({ id: 'evt_3', type: 'account.updated' });
    expect(result.eventId).toBe('evt_3');
    expect(result.objectId).toBeNull();
    expect(result.amountCents).toBeNull();
    expect(result.currency).toBeNull();
  });
});
