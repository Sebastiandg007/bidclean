import { EscrowChargeService } from '../escrow/escrow-charge.service';
import { CommissionService } from '../../offers/commission/commission.service';

describe('EscrowChargeService', () => {
  const OFFER = { offerId: 'offer-1', hostId: 'host-1', cleanerId: 'cleaner-1' };
  const RATES = { currency: 'USD', hostServiceFeeRateBps: 1000, cleanerCommissionRateBps: 300 };

  function buildDeps() {
    const commission = new CommissionService();
    const stripe = { createPaymentIntent: jest.fn() };
    const repo = {
      findPaymentByOffer: jest.fn().mockResolvedValue(null),
      findOfferRates: jest.fn().mockResolvedValue(RATES),
      resolveAgreedPriceCents: jest.fn().mockResolvedValue(10000),
      createPaymentWithAttempt: jest.fn().mockResolvedValue({
        payment: { id: 'pay-1' },
        attempt: { id: 'att-1', attemptNumber: 1 },
      }),
      recordAttemptIntentId: jest.fn(),
      markChargeSucceeded: jest.fn(),
      markChargeFailed: jest.fn(),
      appendEvent: jest.fn(),
    };
    const publisher = { emitCaptured: jest.fn(), emitFailed: jest.fn() };
    const service = new EscrowChargeService(
      commission,
      stripe as never,
      repo as never,
      publisher as never,
    );
    return { service, stripe, repo, publisher };
  }

  it('charges the host, records fee, and emits payment.captured on success', async () => {
    const { service, stripe, repo, publisher } = buildDeps();
    stripe.createPaymentIntent.mockResolvedValue({
      id: 'pi_1',
      latest_charge: { id: 'ch_1', balance_transaction: { fee: 320 } },
    });

    await service.chargeForOffer(OFFER);

    // host_total = 10000 + 10% = 11000
    expect(stripe.createPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 11000, currency: 'usd' }),
      'charge:offer-1:1',
    );
    // Records the real intent id before the terminal write (crash-recovery window).
    expect(repo.recordAttemptIntentId).toHaveBeenCalledWith('att-1', 'pi_1');
    expect(repo.markChargeSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'pay-1',
        stripePaymentIntentId: 'pi_1',
        stripeChargeId: 'ch_1',
        stripeFeeCents: 320,
      }),
    );
    expect(publisher.emitCaptured).toHaveBeenCalledTimes(1);
    expect(publisher.emitFailed).not.toHaveBeenCalled();
  });

  it('short-circuits when the offer is already charged (P3)', async () => {
    const { service, stripe, repo } = buildDeps();
    repo.findPaymentByOffer.mockResolvedValue({ paymentStatus: 'HELD' });
    await service.chargeForOffer(OFFER);
    expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
  });

  it('marks FAILED and emits payment.failed on charge error (no transfer)', async () => {
    const { service, stripe, repo, publisher } = buildDeps();
    stripe.createPaymentIntent.mockRejectedValue(new Error('card_declined'));

    await service.chargeForOffer(OFFER);

    expect(repo.markChargeFailed).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: 'pay-1', failureReason: 'card_declined' }),
    );
    expect(publisher.emitFailed).toHaveBeenCalledTimes(1);
    expect(publisher.emitCaptured).not.toHaveBeenCalled();
  });

  it('computes a breakdown consistent with CommissionService (P2)', async () => {
    const { service, repo, stripe } = buildDeps();
    stripe.createPaymentIntent.mockResolvedValue({ id: 'pi_1', latest_charge: { id: 'ch_1' } });
    await service.chargeForOffer(OFFER);
    const snapshot = repo.createPaymentWithAttempt.mock.calls[0][0].snapshot;
    // 10000 base -> host_total 11000, cleaner_payout 9700, gross 1300
    expect(snapshot.hostTotalCents).toBe(11000);
    expect(snapshot.cleanerPayoutCents).toBe(9700);
    expect(snapshot.platformGrossRevenueCents).toBe(1300);
  });

  it('aborts when offer rates or price cannot be resolved', async () => {
    const { service, repo, stripe } = buildDeps();
    repo.resolveAgreedPriceCents.mockResolvedValue(null);
    await service.chargeForOffer(OFFER);
    expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
  });
});
