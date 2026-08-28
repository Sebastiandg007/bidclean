import { EscrowReleaseService } from '../escrow/escrow-release.service';
import { ConflictException } from '@nestjs/common';
import { PaymentStatus, PayoutStatus, DisputeStatus, ReleaseReason } from '../payments.types';

describe('EscrowReleaseService', () => {
  function buildDeps() {
    const stripe = { createTransfer: jest.fn() };
    const repo = {
      findPaymentById: jest.fn(),
      findAccountByCleaner: jest.fn(),
      markReleased: jest.fn(),
      markPayoutDeferred: jest.fn(),
      appendEvent: jest.fn(),
      findPendingPayoutsForCleaner: jest.fn(),
    };
    const publisher = { emitReleased: jest.fn() };
    const service = new EscrowReleaseService(stripe as never, repo as never, publisher as never);
    return { service, stripe, repo, publisher };
  }

  const heldPayment = {
    id: 'pay-1',
    offerId: 'offer-1',
    hostId: 'host-1',
    cleanerId: 'cleaner-1',
    paymentStatus: PaymentStatus.HELD,
    disputeStatus: DisputeStatus.NONE,
    payoutStatus: PayoutStatus.NOT_READY,
    cleanerPayoutCents: 9700,
    currency: 'USD',
  };

  it('creates a Transfer and marks released when payouts are enabled', async () => {
    const { service, stripe, repo, publisher } = buildDeps();
    repo.findPaymentById.mockResolvedValue({ ...heldPayment });
    repo.findAccountByCleaner.mockResolvedValue({
      payoutsEnabled: true,
      stripeAccountId: 'acct_1',
    });
    stripe.createTransfer.mockResolvedValue({ id: 'tr_1' });

    await service.release('pay-1', ReleaseReason.HOST_CONFIRMED);

    expect(stripe.createTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 9700, destination: 'acct_1' }),
      'release:pay-1',
    );
    expect(repo.markReleased).toHaveBeenCalledWith({ paymentId: 'pay-1', stripeTransferId: 'tr_1' });
    expect(publisher.emitReleased).toHaveBeenCalledTimes(1);
  });

  it('defers the payout when the account is not payout-enabled (P6)', async () => {
    const { service, stripe, repo } = buildDeps();
    repo.findPaymentById.mockResolvedValue({ ...heldPayment });
    repo.findAccountByCleaner.mockResolvedValue({ payoutsEnabled: false, stripeAccountId: 'acct_1' });

    await service.release('pay-1', ReleaseReason.HOST_CONFIRMED);

    expect(stripe.createTransfer).not.toHaveBeenCalled();
    expect(repo.markPayoutDeferred).toHaveBeenCalledWith('pay-1');
  });

  it('is idempotent: skips when already released (P4)', async () => {
    const { service, stripe, repo } = buildDeps();
    repo.findPaymentById.mockResolvedValue({
      ...heldPayment,
      payoutStatus: PayoutStatus.TRANSFER_CREATED,
    });
    await service.release('pay-1', ReleaseReason.AUTO_RELEASE);
    expect(stripe.createTransfer).not.toHaveBeenCalled();
  });

  it('refuses to release a disputed payment (P5)', async () => {
    const { service } = buildDeps();
    const { repo } = buildDeps();
    repo.findPaymentById.mockResolvedValue({ ...heldPayment, disputeStatus: DisputeStatus.OPEN });
    const svc = new EscrowReleaseService(
      { createTransfer: jest.fn() } as never,
      repo as never,
      { emitReleased: jest.fn() } as never,
    );
    await expect(svc.release('pay-1', ReleaseReason.AUTO_RELEASE)).rejects.toBeInstanceOf(
      ConflictException,
    );
    void service;
  });

  it('refuses to release a non-releasable status', async () => {
    const { service, repo } = buildDeps();
    repo.findPaymentById.mockResolvedValue({ ...heldPayment, paymentStatus: PaymentStatus.PENDING });
    await expect(service.release('pay-1', ReleaseReason.HOST_CONFIRMED)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('releases all deferred payouts for a newly-eligible cleaner', async () => {
    const { service, stripe, repo, publisher } = buildDeps();
    repo.findPendingPayoutsForCleaner.mockResolvedValue([{ id: 'pay-1' }, { id: 'pay-2' }]);
    repo.findPaymentById.mockResolvedValue({ ...heldPayment });
    repo.findAccountByCleaner.mockResolvedValue({ payoutsEnabled: true, stripeAccountId: 'acct_1' });
    stripe.createTransfer.mockResolvedValue({ id: 'tr_x' });

    const count = await service.releaseDeferredForCleaner('cleaner-1');
    expect(count).toBe(2);
    expect(publisher.emitReleased).toHaveBeenCalledTimes(2);
  });
});
