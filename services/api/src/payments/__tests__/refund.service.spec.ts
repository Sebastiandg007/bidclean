import { RefundService } from '../refunds/refund.service';
import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DisputeStatus, PaymentStatus, PayoutStatus } from '../payments.types';

describe('RefundService', () => {
  function buildDeps() {
    const stripe = {
      createRefund: jest.fn().mockResolvedValue({ id: 're_1' }),
      createTransferReversal: jest.fn().mockResolvedValue({ id: 'trr_1' }),
    };
    const repo = {
      findPaymentByOffer: jest.fn(),
      applyRefund: jest.fn(),
      appendEvent: jest.fn(),
      findPaymentById: jest.fn(),
    };
    const publisher = { emitRefunded: jest.fn() };
    const service = new RefundService(stripe as never, repo as never, publisher as never);
    return { service, stripe, repo, publisher };
  }

  const basePayment = {
    id: 'pay-1',
    offerId: 'offer-1',
    hostId: 'host-1',
    cleanerId: 'cleaner-1',
    paymentStatus: PaymentStatus.HELD,
    payoutStatus: PayoutStatus.NOT_READY,
    disputeStatus: DisputeStatus.NONE,
    hostTotalCents: 11000,
    cleanerPayoutCents: 9700,
    refundedAmountCents: 0,
    reversedAmountCents: 0,
    stripeTransferId: null,
    currency: 'USD',
  };

  it('pre-release: creates a Refund with no reversal', async () => {
    const { service, stripe, repo } = buildDeps();
    repo.findPaymentByOffer.mockResolvedValue({ ...basePayment });
    repo.findPaymentById.mockResolvedValue({
      ...basePayment,
      createdAt: new Date(),
      heldAt: null,
      releasedAt: null,
      platformGrossRevenueCents: 1300,
      stripeFeeCents: 0,
      netPlatformRevenueCents: 1300,
    });

    await service.refund('host-1', 'offer-1', { amountCents: 5000 }, 'idem-1');

    expect(stripe.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5000 }),
      'refund:pay-1:idem-1',
    );
    expect(stripe.createTransferReversal).not.toHaveBeenCalled();
    expect(repo.applyRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        refundAmountCents: 5000,
        reversalAmountCents: 0,
        resultingStatus: PaymentStatus.PARTIALLY_REFUNDED,
      }),
    );
  });

  it('post-release: creates a Transfer Reversal then a Refund', async () => {
    const { service, stripe, repo } = buildDeps();
    repo.findPaymentByOffer.mockResolvedValue({
      ...basePayment,
      paymentStatus: PaymentStatus.RELEASED,
      payoutStatus: PayoutStatus.PAID,
      stripeTransferId: 'tr_1',
    });
    repo.findPaymentById.mockResolvedValue({
      ...basePayment,
      paymentStatus: PaymentStatus.REFUNDED,
      createdAt: new Date(),
      heldAt: null,
      releasedAt: null,
      platformGrossRevenueCents: 1300,
      stripeFeeCents: 320,
      netPlatformRevenueCents: 1300,
    });

    await service.refund('host-1', 'offer-1', {}, 'idem-2');

    expect(stripe.createTransferReversal).toHaveBeenCalledWith(
      'tr_1',
      { amount: 9700 },
      'reversal:pay-1:idem-2',
    );
    expect(stripe.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 11000 }),
      'refund:pay-1:idem-2',
    );
  });

  it('blocks with 409 when a dispute is open', async () => {
    const { service, repo } = buildDeps();
    repo.findPaymentByOffer.mockResolvedValue({
      ...basePayment,
      disputeStatus: DisputeStatus.OPEN,
    });
    await expect(
      service.refund('host-1', 'offer-1', { amountCents: 100 }, 'k'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects with 422 when the amount exceeds the ceiling', async () => {
    const { service, repo } = buildDeps();
    repo.findPaymentByOffer.mockResolvedValue({ ...basePayment });
    await expect(
      service.refund('host-1', 'offer-1', { amountCents: 99999 }, 'k'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects a non-owner host with 403', async () => {
    const { service, repo } = buildDeps();
    repo.findPaymentByOffer.mockResolvedValue({ ...basePayment });
    await expect(
      service.refund('intruder', 'offer-1', { amountCents: 100 }, 'k'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
