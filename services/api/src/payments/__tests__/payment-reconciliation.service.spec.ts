import { PaymentReconciliationService } from '../reconciliation/payment-reconciliation.service';
import { AttemptStatus } from '../payments.types';

describe('PaymentReconciliationService', () => {
  function buildDeps() {
    const stripe = {
      retrievePaymentIntent: jest.fn(),
      findPaymentIntentByPaymentId: jest.fn().mockResolvedValue(null),
      listDisputesForCharge: jest.fn().mockResolvedValue([]),
    };
    const repo = {
      listAttempts: jest.fn(),
      markChargeSucceeded: jest.fn(),
      markChargeFailed: jest.fn(),
      findProcessingPayments: jest.fn(),
      findChargedPaymentsForDisputeCheck: jest.fn().mockResolvedValue([]),
    };
    const disputes = { openDispute: jest.fn(), closeDispute: jest.fn() };
    const service = new PaymentReconciliationService(
      stripe as never,
      repo as never,
      disputes as never,
    );
    return { service, stripe, repo, disputes };
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

  it('falls back to metadata search for a pending placeholder and leaves it PROCESSING when unresolved', async () => {
    const { service, stripe, repo } = buildDeps();
    repo.listAttempts.mockResolvedValue([
      { id: 'att-1', status: AttemptStatus.PROCESSING, stripePaymentIntentId: 'pending:offer-1:123' },
    ]);
    stripe.findPaymentIntentByPaymentId.mockResolvedValue(null);
    await service.reconcilePayment('pay-1');
    expect(stripe.findPaymentIntentByPaymentId).toHaveBeenCalledWith('pay-1');
    expect(stripe.retrievePaymentIntent).not.toHaveBeenCalled();
    expect(repo.markChargeSucceeded).not.toHaveBeenCalled();
  });

  it('heals a pending placeholder when Stripe returns the succeeded intent by metadata (P11)', async () => {
    const { service, stripe, repo } = buildDeps();
    repo.listAttempts.mockResolvedValue([
      { id: 'att-1', status: AttemptStatus.PROCESSING, stripePaymentIntentId: 'pending:offer-1:123' },
    ]);
    stripe.findPaymentIntentByPaymentId.mockResolvedValue({
      id: 'pi_real',
      status: 'succeeded',
      latest_charge: { id: 'ch_1', balance_transaction: { fee: 300 } },
    });
    await service.reconcilePayment('pay-1');
    expect(repo.markChargeSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({ stripePaymentIntentId: 'pi_real', stripeChargeId: 'ch_1', stripeFeeCents: 300 }),
    );
  });

  it('leaves a non-terminal intent (requires_action) in PROCESSING without failing it', async () => {
    const { service, stripe, repo } = buildDeps();
    repo.listAttempts.mockResolvedValue([
      { id: 'att-1', status: AttemptStatus.PROCESSING, stripePaymentIntentId: 'pi_1' },
    ]);
    stripe.retrievePaymentIntent.mockResolvedValue({ status: 'requires_action' });
    await service.reconcilePayment('pay-1');
    expect(repo.markChargeFailed).not.toHaveBeenCalled();
    expect(repo.markChargeSucceeded).not.toHaveBeenCalled();
  });

  it('sweep reconciles each stuck payment and swallows errors', async () => {
    const { service, stripe, repo } = buildDeps();
    repo.findProcessingPayments.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
    repo.listAttempts.mockResolvedValue([]);
    await expect(service.sweep()).resolves.toBeUndefined();
    void stripe;
  });

  describe('dispute reconciliation (webhook backstop)', () => {
    it('opens a dispute Stripe reports but the webhook missed (pauses auto-release, P5)', async () => {
      const { service, stripe, repo, disputes } = buildDeps();
      repo.findChargedPaymentsForDisputeCheck.mockImplementation((statuses: string[]) =>
        statuses[0] === 'NONE'
          ? Promise.resolve([{ paymentId: 'pay-1', stripeChargeId: 'ch_1' }])
          : Promise.resolve([]),
      );
      stripe.listDisputesForCharge.mockResolvedValue([{ id: 'dp_1', status: 'needs_response' }]);
      await service.reconcileDisputes();
      expect(disputes.openDispute).toHaveBeenCalledWith('pay-1');
      expect(disputes.closeDispute).not.toHaveBeenCalled();
    });

    it('closes an OPEN dispute Stripe resolved as won', async () => {
      const { service, stripe, repo, disputes } = buildDeps();
      repo.findChargedPaymentsForDisputeCheck.mockImplementation((statuses: string[]) =>
        statuses[0] === 'OPEN'
          ? Promise.resolve([{ paymentId: 'pay-1', stripeChargeId: 'ch_1' }])
          : Promise.resolve([]),
      );
      stripe.listDisputesForCharge.mockResolvedValue([{ id: 'dp_1', status: 'won' }]);
      await service.reconcileDisputes();
      expect(disputes.closeDispute).toHaveBeenCalledWith('pay-1', true);
    });

    it('closes an OPEN dispute Stripe resolved as lost', async () => {
      const { service, stripe, repo, disputes } = buildDeps();
      repo.findChargedPaymentsForDisputeCheck.mockImplementation((statuses: string[]) =>
        statuses[0] === 'OPEN'
          ? Promise.resolve([{ paymentId: 'pay-1', stripeChargeId: 'ch_1' }])
          : Promise.resolve([]),
      );
      stripe.listDisputesForCharge.mockResolvedValue([{ id: 'dp_1', status: 'lost' }]);
      await service.reconcileDisputes();
      expect(disputes.closeDispute).toHaveBeenCalledWith('pay-1', false);
    });

    it('does nothing when Stripe reports no dispute for the charge', async () => {
      const { service, stripe, repo, disputes } = buildDeps();
      repo.findChargedPaymentsForDisputeCheck.mockResolvedValue([
        { paymentId: 'pay-1', stripeChargeId: 'ch_1' },
      ]);
      stripe.listDisputesForCharge.mockResolvedValue([]);
      await service.reconcileDisputes();
      expect(disputes.openDispute).not.toHaveBeenCalled();
      expect(disputes.closeDispute).not.toHaveBeenCalled();
    });

    it('swallows errors so the sweep never throws', async () => {
      const { service, repo } = buildDeps();
      repo.findChargedPaymentsForDisputeCheck.mockRejectedValue(new Error('db down'));
      await expect(service.reconcileDisputes()).resolves.toBeUndefined();
    });
  });
});
