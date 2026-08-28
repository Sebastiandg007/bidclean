/**
 * StripeClient unit tests with a fully mocked Stripe SDK.
 *
 * Verifies that idempotency keys are forwarded on every mutating call and that
 * webhook construction delegates to the SDK with the signing secret + tolerance
 * window (Property P9 is exercised end-to-end in the webhook controller tests).
 */

const paymentIntentsCreate = jest.fn();
const transfersCreate = jest.fn();
const transfersCreateReversal = jest.fn();
const refundsCreate = jest.fn();
const accountsCreate = jest.fn();
const accountLinksCreate = jest.fn();
const constructEvent = jest.fn();

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    accounts: { create: accountsCreate, retrieve: jest.fn() },
    accountLinks: { create: accountLinksCreate },
    paymentIntents: { create: paymentIntentsCreate, retrieve: jest.fn() },
    transfers: { create: transfersCreate, createReversal: transfersCreateReversal },
    refunds: { create: refundsCreate },
    webhooks: { constructEvent },
  }));
});

import { StripeClient } from '../stripe/stripe.client';

describe('StripeClient', () => {
  let client: StripeClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new StripeClient();
  });

  it('forwards the idempotency key when creating a PaymentIntent', async () => {
    paymentIntentsCreate.mockResolvedValue({ id: 'pi_1' });
    await client.createPaymentIntent({ amount: 11000, currency: 'usd' }, 'charge:offer-1:1');
    expect(paymentIntentsCreate).toHaveBeenCalledWith(
      { amount: 11000, currency: 'usd' },
      { idempotencyKey: 'charge:offer-1:1' },
    );
  });

  it('forwards the idempotency key when creating a Transfer', async () => {
    transfersCreate.mockResolvedValue({ id: 'tr_1' });
    await client.createTransfer({ amount: 9700, currency: 'usd', destination: 'acct_1' }, 'release:pay-1');
    expect(transfersCreate).toHaveBeenCalledWith(
      expect.objectContaining({ destination: 'acct_1' }),
      { idempotencyKey: 'release:pay-1' },
    );
  });

  it('forwards the idempotency key when reversing a Transfer', async () => {
    transfersCreateReversal.mockResolvedValue({ id: 'trr_1' });
    await client.createTransferReversal('tr_1', { amount: 9700 }, 'reversal:pay-1:k');
    expect(transfersCreateReversal).toHaveBeenCalledWith(
      'tr_1',
      { amount: 9700 },
      { idempotencyKey: 'reversal:pay-1:k' },
    );
  });

  it('forwards the idempotency key when creating a Refund', async () => {
    refundsCreate.mockResolvedValue({ id: 're_1' });
    await client.createRefund({ payment_intent: 'pi_1', amount: 5000 }, 'refund:pay-1:k');
    expect(refundsCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_1', amount: 5000 },
      { idempotencyKey: 'refund:pay-1:k' },
    );
  });

  it('delegates webhook construction to the SDK (signature + tolerance)', () => {
    constructEvent.mockReturnValue({ id: 'evt_1', type: 'payment_intent.succeeded' });
    const event = client.constructWebhookEvent(Buffer.from('{}'), 'sig');
    expect(event.id).toBe('evt_1');
    expect(constructEvent).toHaveBeenCalledTimes(1);
    // secret + numeric tolerance window are passed through
    expect(constructEvent.mock.calls[0][2]).toBeDefined();
    expect(typeof constructEvent.mock.calls[0][3]).toBe('number');
  });

  it('propagates a thrown signature error (invalid/old)', () => {
    constructEvent.mockImplementation(() => {
      throw new Error('Webhook signature verification failed');
    });
    expect(() => client.constructWebhookEvent(Buffer.from('{}'), 'bad')).toThrow(
      'signature verification failed',
    );
  });
});
