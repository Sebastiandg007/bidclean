import { StripeWebhookProcessor } from '../webhooks/stripe-webhook.processor';
import { STRIPE_WEBHOOK_EVENTS } from '../stripe/stripe.constants';
import { PayoutStatus } from '../payments.types';
import { Job } from 'bullmq';

describe('StripeWebhookProcessor', () => {
  function buildProcessor() {
    const repo = {
      findPaymentByTransferId: jest.fn(),
      findPaymentByChargeId: jest.fn(),
      findAccountByStripeId: jest.fn(),
      setPayoutStatus: jest.fn(),
    };
    const disputes = { openDispute: jest.fn(), closeDispute: jest.fn() };
    const connectReconciliation = { reconcileAccount: jest.fn() };
    const processor = new StripeWebhookProcessor(
      repo as never,
      disputes as never,
      connectReconciliation as never,
    );
    return { processor, repo, disputes, connectReconciliation };
  }

  const job = (eventType: string, sanitized: Record<string, unknown>): Job =>
    ({ data: { stripeEventId: 'evt_1', eventType, sanitized } }) as never;

  it('sets payout PAID on transfer.paid', async () => {
    const { processor, repo } = buildProcessor();
    repo.findPaymentByTransferId.mockResolvedValue({ id: 'pay-1' });
    await processor.process(job(STRIPE_WEBHOOK_EVENTS.TRANSFER_PAID, { objectId: 'tr_1' }));
    expect(repo.setPayoutStatus).toHaveBeenCalledWith('pay-1', PayoutStatus.PAID);
  });

  it('sets payout REVERSED on transfer.reversed', async () => {
    const { processor, repo } = buildProcessor();
    repo.findPaymentByTransferId.mockResolvedValue({ id: 'pay-1' });
    await processor.process(job(STRIPE_WEBHOOK_EVENTS.TRANSFER_REVERSED, { objectId: 'tr_1' }));
    expect(repo.setPayoutStatus).toHaveBeenCalledWith('pay-1', PayoutStatus.REVERSED);
  });

  it('opens a dispute on charge.dispute.created', async () => {
    const { processor, repo, disputes } = buildProcessor();
    repo.findPaymentByChargeId.mockResolvedValue({ id: 'pay-1' });
    await processor.process(job(STRIPE_WEBHOOK_EVENTS.DISPUTE_CREATED, { objectId: 'ch_1' }));
    expect(disputes.openDispute).toHaveBeenCalledWith('pay-1');
  });

  it('closes a dispute as won when status is won', async () => {
    const { processor, repo, disputes } = buildProcessor();
    repo.findPaymentByChargeId.mockResolvedValue({ id: 'pay-1' });
    await processor.process(
      job(STRIPE_WEBHOOK_EVENTS.DISPUTE_CLOSED, { objectId: 'ch_1', status: 'won' }),
    );
    expect(disputes.closeDispute).toHaveBeenCalledWith('pay-1', true);
  });

  it('reconciles the account on account.updated (idempotent path)', async () => {
    const { processor, repo, connectReconciliation } = buildProcessor();
    repo.findAccountByStripeId.mockResolvedValue({ cleanerId: 'c1' });
    await processor.process(job(STRIPE_WEBHOOK_EVENTS.ACCOUNT_UPDATED, { objectId: 'acct_1' }));
    expect(connectReconciliation.reconcileAccount).toHaveBeenCalledWith('acct_1', 'c1');
  });

  it('records-only for payment_intent.succeeded (no dispatch branch)', async () => {
    const { processor, repo } = buildProcessor();
    await processor.process(
      job(STRIPE_WEBHOOK_EVENTS.PAYMENT_INTENT_SUCCEEDED, { objectId: 'pi_1' }),
    );
    expect(repo.setPayoutStatus).not.toHaveBeenCalled();
  });
});
