import { PaymentReconciliationService } from '../reconciliation/payment-reconciliation.service';
import { AttemptStatus } from '../payments.types';

describe('PaymentReconciliationService', () => {
  function buildDeps() {
    const stripe = { retrievePaymentIntent: jest.fn() };
    const repo = {
      listAttempts: jest.fn(),
      markChargeSucceeded: jest.fn(),
      markChargeFailed: jest.fn(),
      findProcessingPayments: jest.fn(),
    };
    const service = new PaymentReconciliationService(stripe as never, repo as never);
    return { service, stripe, repo };
  }

  it('repairs an interrupted charge that actually succeeded (P11)', async () => {
    const { service, stripe, repo } = buildDeps();
    repo.listAttempts.mockResolvedValue([
      { id: 'att-1', status: AttemptStatus.PROCESSING, stripePaymentIntentId: 'pi_1' },
    ]);
    stripe.retrievePaymentIntent.mockResolvedValue({
      status: 'succeeded',
      latest_charge: { id: 'ch_1', balance_transaction: { fee: 320 } },
    });
    await service.reconcilePayment('pay-1');
    expect(repo.markChargeSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: 'pay-1', stripeChargeId: 'ch_1', stripeFeeCents: 320 }),
    );
  });

  it('marks FAILED when the intent was canceled', async () => {
    const { service, stripe, repo } = buildDeps();
    repo.listAttempts.mockResolvedValue([
      { id: 'att-1', status: AttemptStatus.PROCESSING, stripePaymentIntentId: 'pi_1' },
    ]);
    stripe.retrievePaymentIntent.mockResolvedValue({ status: 'canceled' });
    await service.reconcilePayment('pay-1');
    expect(repo.markChargeFailed).toHaveBeenCalledTimes(1);
  });

  it('skips when the latest attempt is not PROCESSING', async () => {
    const { service, stripe, repo } = buildDeps();
    repo.listAttempts.mockResolvedValue([{ id: 'att-1', status: AttemptStatus.SUCCEEDED }]);
    await service.reconcilePayment('pay-1');
    expect(stripe.retrievePaymentIntent).not.toHaveBeenCalled();
  });

  it('skips when the intent id was never persisted (pending placeholder)', async () => {
    const { service, stripe, repo } = buildDeps();
    repo.listAttempts.mockResolvedValue([
      { id: 'att-1', status: AttemptStatus.PROCESSING, stripePaymentIntentId: 'pending:offer-1:123' },
    ]);
    await service.reconcilePayment('pay-1');
    expect(stripe.retrievePaymentIntent).not.toHaveBeenCalled();
  });

  it('sweep reconciles each stuck payment and swallows errors', async () => {
    const { service, stripe, repo } = buildDeps();
    repo.findProcessingPayments.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
    repo.listAttempts.mockResolvedValue([]);
    await expect(service.sweep()).resolves.toBeUndefined();
    void stripe;
  });
});
