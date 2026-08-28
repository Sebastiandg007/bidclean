import { BadRequestException } from '@nestjs/common';
import { StripeWebhookController } from '../webhooks/stripe-webhook.controller';

describe('StripeWebhookController', () => {
  function buildController() {
    const stripe = { constructWebhookEvent: jest.fn() };
    const repo = { hasProcessedStripeEvent: jest.fn().mockResolvedValue(false), appendEvent: jest.fn() };
    const queue = { add: jest.fn() };
    const controller = new StripeWebhookController(stripe as never, repo as never, queue as never);
    return { controller, stripe, repo, queue };
  }

  const req = (rawBody?: Buffer) => ({ rawBody }) as never;

  it('rejects a missing signature header (400)', async () => {
    const { controller } = buildController();
    await expect(
      controller.handleStripeWebhook(req(Buffer.from('{}')), undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a missing raw body (400)', async () => {
    const { controller } = buildController();
    await expect(controller.handleStripeWebhook(req(undefined), 'sig')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects an invalid/old signature and does not mutate (P9)', async () => {
    const { controller, stripe, repo, queue } = buildController();
    stripe.constructWebhookEvent.mockImplementation(() => {
      throw new Error('signature verification failed');
    });
    await expect(
      controller.handleStripeWebhook(req(Buffer.from('{}')), 'bad-sig'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.appendEvent).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('persists + enqueues a valid new event and ACKs', async () => {
    const { controller, stripe, repo, queue } = buildController();
    stripe.constructWebhookEvent.mockReturnValue({
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', amount: 11000, currency: 'usd', status: 'succeeded' } },
    });
    const result = await controller.handleStripeWebhook(req(Buffer.from('{}')), 'sig');
    expect(result).toEqual({ received: true });
    expect(repo.appendEvent).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('dedups a redelivered event (P8): ACK without reprocessing', async () => {
    const { controller, stripe, repo, queue } = buildController();
    repo.hasProcessedStripeEvent.mockResolvedValue(true);
    stripe.constructWebhookEvent.mockReturnValue({
      id: 'evt_dup',
      type: 'payment_intent.succeeded',
      data: { object: {} },
    });
    const result = await controller.handleStripeWebhook(req(Buffer.from('{}')), 'sig');
    expect(result).toEqual({ received: true });
    expect(repo.appendEvent).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});
