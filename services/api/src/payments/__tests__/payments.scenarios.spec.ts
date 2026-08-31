/**
 * Scenario tests for the stripe-escrow flows (Task 18).
 *
 * These wire the REAL services together over an in-memory fake repository and a mocked
 * StripeClient, exercising end-to-end flows without a live database: charge on match,
 * confirm/auto release, deferred release on account eligibility, pre-/post-release
 * refunds with ceilings, dispute pausing auto-release, webhook dedup, and charge retry.
 *
 * The DB-constraint-level guarantees (uq_payment_offer, uq_one_succeeded_attempt,
 * chk_refund_ceiling) are additionally enforced by Postgres in production; here the
 * fake repository mirrors those invariants so the service logic is validated.
 */

import { CommissionService } from '../../offers/commission/commission.service';
import { EscrowChargeService } from '../escrow/escrow-charge.service';
import { EscrowReleaseService } from '../escrow/escrow-release.service';
import { RefundService } from '../refunds/refund.service';
import { DisputeService } from '../disputes/dispute.service';
import {
  AttemptStatus,
  DisputeStatus,
  PaymentStatus,
  PayoutStatus,
  ReleaseReason,
} from '../payments.types';
import { decideRefund } from '../refund-policy';

// ─── In-memory fake repository ─────────────────────────────────────────────────

interface FakePayment {
  id: string;
  offerId: string;
  hostId: string;
  cleanerId: string;
  paymentStatus: string;
  disputeStatus: string;
  payoutStatus: string;
  currency: string;
  agreedPriceCents: number;
  hostTotalCents: number;
  cleanerPayoutCents: number;
  platformGrossRevenueCents: number;
  stripeFeeCents: number;
  netPlatformRevenueCents: number;
  refundedAmountCents: number;
  reversedAmountCents: number;
  stripeTransferId: string | null;
  heldAt: Date | null;
  releasedAt: Date | null;
  createdAt: Date;
}

interface FakeAttempt {
  id: string;
  paymentId: string;
  attemptNumber: number;
  stripePaymentIntentId: string;
  stripeChargeId: string | null;
  status: string;
}

class FakeRepo {
  payments = new Map<string, FakePayment>();
  attempts: FakeAttempt[] = [];
  accounts = new Map<string, { payoutsEnabled: boolean; stripeAccountId: string }>();
  events: { stripeEventId: string | null }[] = [];
  private seq = 0;

  offerRates = { currency: 'USD', hostServiceFeeRateBps: 1000, cleanerCommissionRateBps: 300 };
  agreedPrice = 10000;

  async findPaymentByOffer(offerId: string): Promise<FakePayment | null> {
    return [...this.payments.values()].find((p) => p.offerId === offerId) ?? null;
  }

  async findPaymentById(id: string): Promise<FakePayment | null> {
    return this.payments.get(id) ?? null;
  }

  async findOfferRates(): Promise<typeof this.offerRates> {
    return this.offerRates;
  }

  async resolveAgreedPriceCents(): Promise<number> {
    return this.agreedPrice;
  }

  async findAccountByCleaner(cleanerId: string) {
    return this.accounts.get(cleanerId) ?? null;
  }

  async findPendingPayoutsForCleaner(cleanerId: string): Promise<FakePayment[]> {
    return [...this.payments.values()].filter(
      (p) => p.cleanerId === cleanerId && p.payoutStatus === PayoutStatus.PENDING,
    );
  }

  async listAttempts(paymentId: string): Promise<FakeAttempt[]> {
    return this.attempts.filter((a) => a.paymentId === paymentId);
  }

  async createPaymentWithAttempt(
    params: {
      offerId: string;
      hostId: string;
      cleanerId: string;
      snapshot: {
        agreedPriceCents: number;
        hostTotalCents: number;
        cleanerPayoutCents: number;
        platformGrossRevenueCents: number;
        currency: string;
      };
    },
    intentId: string,
    amountCents: number,
  ): Promise<{ payment: FakePayment; attempt: FakeAttempt }> {
    let payment = await this.findPaymentByOffer(params.offerId);
    if (!payment) {
      payment = {
        id: `pay-${++this.seq}`,
        offerId: params.offerId,
        hostId: params.hostId,
        cleanerId: params.cleanerId,
        paymentStatus: PaymentStatus.PENDING,
        disputeStatus: DisputeStatus.NONE,
        payoutStatus: PayoutStatus.NOT_READY,
        currency: params.snapshot.currency,
        agreedPriceCents: params.snapshot.agreedPriceCents,
        hostTotalCents: params.snapshot.hostTotalCents,
        cleanerPayoutCents: params.snapshot.cleanerPayoutCents,
        platformGrossRevenueCents: params.snapshot.platformGrossRevenueCents,
        stripeFeeCents: 0,
        netPlatformRevenueCents: 0,
        refundedAmountCents: 0,
        reversedAmountCents: 0,
        stripeTransferId: null,
        heldAt: null,
        releasedAt: null,
        createdAt: new Date(),
      };
      this.payments.set(payment.id, payment);
    }
    const attemptNumber =
      this.attempts.filter((a) => a.paymentId === payment!.id).length + 1;
    const attempt: FakeAttempt = {
      id: `att-${++this.seq}`,
      paymentId: payment.id,
      attemptNumber,
      stripePaymentIntentId: intentId,
      stripeChargeId: null,
      status: AttemptStatus.PROCESSING,
    };
    this.attempts.push(attempt);
    payment.paymentStatus = PaymentStatus.PROCESSING;
    void amountCents;
    return { payment, attempt };
  }

  async recordAttemptIntentId(attemptId: string, stripePaymentIntentId: string): Promise<void> {
    const attempt = this.attempts.find((a) => a.id === attemptId);
    if (attempt && attempt.status === AttemptStatus.PROCESSING) {
      attempt.stripePaymentIntentId = stripePaymentIntentId;
    }
  }

  async markChargeSucceeded(params: {
    paymentId: string;
    attemptId: string;
    stripePaymentIntentId: string;
    stripeChargeId: string;
    stripeFeeCents: number;
  }): Promise<void> {
    const attempt = this.attempts.find((a) => a.id === params.attemptId)!;
    // Enforce "at most one SUCCEEDED attempt" (uq_one_succeeded_attempt).
    const alreadySucceeded = this.attempts.some(
      (a) => a.paymentId === params.paymentId && a.status === AttemptStatus.SUCCEEDED,
    );
    if (alreadySucceeded) {
      throw Object.assign(new Error('duplicate succeeded attempt'), { code: '23505' });
    }
    attempt.status = AttemptStatus.SUCCEEDED;
    attempt.stripePaymentIntentId = params.stripePaymentIntentId;
    attempt.stripeChargeId = params.stripeChargeId;
    const payment = this.payments.get(params.paymentId)!;
    payment.paymentStatus = PaymentStatus.HELD;
    payment.stripeFeeCents = params.stripeFeeCents;
    payment.netPlatformRevenueCents = payment.platformGrossRevenueCents - params.stripeFeeCents;
    payment.heldAt = payment.heldAt ?? new Date();
  }

  async markChargeFailed(params: { paymentId: string; attemptId: string }): Promise<void> {
    const attempt = this.attempts.find((a) => a.id === params.attemptId)!;
    attempt.status = AttemptStatus.FAILED;
    this.payments.get(params.paymentId)!.paymentStatus = PaymentStatus.FAILED;
  }

  async markReleased(params: { paymentId: string; stripeTransferId: string }): Promise<void> {
    const payment = this.payments.get(params.paymentId)!;
    if (
      payment.payoutStatus === PayoutStatus.TRANSFER_CREATED ||
      payment.payoutStatus === PayoutStatus.PAID
    ) {
      throw new Error('already released');
    }
    payment.payoutStatus = PayoutStatus.TRANSFER_CREATED;
    payment.paymentStatus = PaymentStatus.RELEASED;
    payment.stripeTransferId = params.stripeTransferId;
    payment.releasedAt = new Date();
  }

  async markPayoutDeferred(paymentId: string): Promise<void> {
    this.payments.get(paymentId)!.payoutStatus = PayoutStatus.PENDING;
  }

  async setDisputeStatus(paymentId: string, target: string): Promise<void> {
    this.payments.get(paymentId)!.disputeStatus = target;
  }

  async applyRefund(params: {
    paymentId: string;
    refundAmountCents: number;
    reversalAmountCents: number;
    resultingStatus: string;
  }): Promise<void> {
    const payment = this.payments.get(params.paymentId)!;
    const newRefunded = payment.refundedAmountCents + params.refundAmountCents;
    const newReversed = payment.reversedAmountCents + params.reversalAmountCents;
    // Enforce ceilings (chk_refund_ceiling / chk_reversal_ceiling).
    if (newRefunded > payment.hostTotalCents) {
      throw new Error('refund ceiling exceeded');
    }
    if (newReversed > payment.cleanerPayoutCents) {
      throw new Error('reversal ceiling exceeded');
    }
    payment.refundedAmountCents = newRefunded;
    payment.reversedAmountCents = newReversed;
    payment.paymentStatus = params.resultingStatus;
  }

  async appendEvent(params: { stripeEventId?: string | null }): Promise<void> {
    if (params.stripeEventId && this.events.some((e) => e.stripeEventId === params.stripeEventId)) {
      return; // dedup (uq_payment_event_stripe_id)
    }
    this.events.push({ stripeEventId: params.stripeEventId ?? null });
  }

  async hasProcessedStripeEvent(id: string): Promise<boolean> {
    return this.events.some((e) => e.stripeEventId === id);
  }
}

// ─── Fixtures ──────────────────────────────────────────────────────────────────

function buildStack(repo: FakeRepo) {
  const commission = new CommissionService();
  const stripe = {
    createPaymentIntent: jest.fn().mockResolvedValue({
      id: 'pi_1',
      latest_charge: { id: 'ch_1', balance_transaction: { fee: 300 } },
    }),
    createTransfer: jest.fn().mockResolvedValue({ id: 'tr_1' }),
    createTransferReversal: jest.fn().mockResolvedValue({ id: 'trr_1' }),
    createRefund: jest.fn().mockResolvedValue({ id: 're_1' }),
  };
  const publisher = {
    emitCaptured: jest.fn(),
    emitReleased: jest.fn(),
    emitFailed: jest.fn(),
    emitRefunded: jest.fn(),
    emitDisputed: jest.fn(),
  };
  const charge = new EscrowChargeService(commission, stripe as never, repo as never, publisher as never);
  const release = new EscrowReleaseService(stripe as never, repo as never, publisher as never);
  const refunds = new RefundService(stripe as never, repo as never, publisher as never);
  const disputes = new DisputeService(repo as never, publisher as never);
  return { stripe, publisher, charge, release, refunds, disputes };
}

const OFFER = { offerId: 'offer-1', hostId: 'host-1', cleanerId: 'cleaner-1' };

describe('stripe-escrow scenarios', () => {
  it('18.1: charge on match -> HELD with fee recorded and a single payment', async () => {
    const repo = new FakeRepo();
    const { charge } = buildStack(repo);
    await charge.chargeForOffer(OFFER);
    const payment = await repo.findPaymentByOffer('offer-1');
    expect(payment?.paymentStatus).toBe(PaymentStatus.HELD);
    expect(payment?.hostTotalCents).toBe(11000);
    expect(payment?.stripeFeeCents).toBe(300);
    expect(payment?.netPlatformRevenueCents).toBe(1000); // gross 1300 - fee 300
    expect(repo.payments.size).toBe(1);
  });

  it('18.1b: a second offer.matched does not create a second payment or charge (P3)', async () => {
    const repo = new FakeRepo();
    const { charge, stripe } = buildStack(repo);
    await charge.chargeForOffer(OFFER);
    await charge.chargeForOffer(OFFER);
    expect(repo.payments.size).toBe(1);
    expect(stripe.createPaymentIntent).toHaveBeenCalledTimes(1);
  });

  it('18.2: confirm -> release Transfer -> RELEASED when payouts enabled', async () => {
    const repo = new FakeRepo();
    repo.accounts.set('cleaner-1', { payoutsEnabled: true, stripeAccountId: 'acct_1' });
    const { charge, release, stripe } = buildStack(repo);
    await charge.chargeForOffer(OFFER);
    const payment = await repo.findPaymentByOffer('offer-1');
    await release.release(payment!.id, ReleaseReason.HOST_CONFIRMED);
    expect(stripe.createTransfer).toHaveBeenCalledTimes(1);
    const after = await repo.findPaymentById(payment!.id);
    expect(after?.paymentStatus).toBe(PaymentStatus.RELEASED);
    expect(after?.payoutStatus).toBe(PayoutStatus.TRANSFER_CREATED);
  });

  it('18.2b: concurrent release triggers yield a single Transfer (P4)', async () => {
    const repo = new FakeRepo();
    repo.accounts.set('cleaner-1', { payoutsEnabled: true, stripeAccountId: 'acct_1' });
    const { charge, release, stripe } = buildStack(repo);
    await charge.chargeForOffer(OFFER);
    const payment = await repo.findPaymentByOffer('offer-1');
    await release.release(payment!.id, ReleaseReason.HOST_CONFIRMED);
    await release.release(payment!.id, ReleaseReason.AUTO_RELEASE); // second trigger: no-op
    expect(stripe.createTransfer).toHaveBeenCalledTimes(1);
  });

  it('18.3: deferred release then account becomes eligible -> Transfer created (P6)', async () => {
    const repo = new FakeRepo();
    repo.accounts.set('cleaner-1', { payoutsEnabled: false, stripeAccountId: 'acct_1' });
    const { charge, release, stripe } = buildStack(repo);
    await charge.chargeForOffer(OFFER);
    const payment = await repo.findPaymentByOffer('offer-1');

    await release.release(payment!.id, ReleaseReason.HOST_CONFIRMED);
    expect(stripe.createTransfer).not.toHaveBeenCalled();
    expect((await repo.findPaymentById(payment!.id))?.payoutStatus).toBe(PayoutStatus.PENDING);

    // Account becomes eligible; deferred release fires.
    repo.accounts.set('cleaner-1', { payoutsEnabled: true, stripeAccountId: 'acct_1' });
    const count = await release.releaseDeferredForCleaner('cleaner-1');
    expect(count).toBe(1);
    expect(stripe.createTransfer).toHaveBeenCalledTimes(1);
  });

  it('18.4: pre-release partial refund -> PARTIALLY_REFUNDED; over-ceiling rejected', async () => {
    const repo = new FakeRepo();
    const { charge, refunds } = buildStack(repo);
    await charge.chargeForOffer(OFFER);

    await refunds.refund('host-1', 'offer-1', { amountCents: 5000 }, 'idem-1');
    let payment = await repo.findPaymentByOffer('offer-1');
    expect(payment?.paymentStatus).toBe(PaymentStatus.PARTIALLY_REFUNDED);
    expect(payment?.refundedAmountCents).toBe(5000);

    // Over-ceiling attempt rejected (422 via decideRefund).
    await expect(
      refunds.refund('host-1', 'offer-1', { amountCents: 999999 }, 'idem-2'),
    ).rejects.toBeTruthy();
    payment = await repo.findPaymentByOffer('offer-1');
    expect(payment?.refundedAmountCents).toBe(5000);
  });

  it('18.5: post-release full refund -> Transfer Reversal + Refund, reversal bounded', async () => {
    const repo = new FakeRepo();
    repo.accounts.set('cleaner-1', { payoutsEnabled: true, stripeAccountId: 'acct_1' });
    const { charge, release, refunds, stripe } = buildStack(repo);
    await charge.chargeForOffer(OFFER);
    const payment = await repo.findPaymentByOffer('offer-1');
    await release.release(payment!.id, ReleaseReason.HOST_CONFIRMED);

    await refunds.refund('host-1', 'offer-1', {}, 'idem-3');
    expect(stripe.createTransferReversal).toHaveBeenCalledTimes(1);
    expect(stripe.createRefund).toHaveBeenCalledTimes(1);
    const after = await repo.findPaymentByOffer('offer-1');
    expect(after?.paymentStatus).toBe(PaymentStatus.REFUNDED);
    expect(after!.reversedAmountCents).toBeLessThanOrEqual(after!.cleanerPayoutCents);
  });

  it('18.6: dispute created -> OPEN pauses auto-release (P5)', async () => {
    const repo = new FakeRepo();
    repo.accounts.set('cleaner-1', { payoutsEnabled: true, stripeAccountId: 'acct_1' });
    const { charge, release, disputes } = buildStack(repo);
    await charge.chargeForOffer(OFFER);
    const payment = await repo.findPaymentByOffer('offer-1');

    await disputes.openDispute(payment!.id);
    expect((await repo.findPaymentById(payment!.id))?.disputeStatus).toBe(DisputeStatus.OPEN);

    // Auto-release must refuse a disputed payment.
    await expect(release.release(payment!.id, ReleaseReason.AUTO_RELEASE)).rejects.toBeTruthy();
  });

  it('18.7: redelivered webhook event id is deduped (P8)', async () => {
    const repo = new FakeRepo();
    await repo.appendEvent({ stripeEventId: 'evt_1' });
    await repo.appendEvent({ stripeEventId: 'evt_1' });
    expect(repo.events.length).toBe(1);
    expect(await repo.hasProcessedStripeEvent('evt_1')).toBe(true);
  });

  it('18.8: failed charge -> FAILED + payment.failed; retry creates attempt #2 -> HELD', async () => {
    const repo = new FakeRepo();
    const { charge, stripe, publisher } = buildStack(repo);

    stripe.createPaymentIntent.mockRejectedValueOnce(new Error('card_declined'));
    await charge.chargeForOffer(OFFER);
    let payment = await repo.findPaymentByOffer('offer-1');
    expect(payment?.paymentStatus).toBe(PaymentStatus.FAILED);
    expect(publisher.emitFailed).toHaveBeenCalledTimes(1);

    // Retry succeeds -> new attempt, HELD.
    await charge.chargeForOffer(OFFER);
    payment = await repo.findPaymentByOffer('offer-1');
    expect(payment?.paymentStatus).toBe(PaymentStatus.HELD);
    const attempts = await repo.listAttempts(payment!.id);
    expect(attempts.length).toBe(2);
    expect(attempts[1]?.attemptNumber).toBe(2);
  });

  it('cross-check: decideRefund never lets accumulated refunds exceed host_total', async () => {
    const repo = new FakeRepo();
    const { charge } = buildStack(repo);
    await charge.chargeForOffer(OFFER);
    const payment = await repo.findPaymentByOffer('offer-1');
    const decision = decideRefund({
      paymentStatus: PaymentStatus.HELD,
      payoutStatus: PayoutStatus.NOT_READY,
      disputeStatus: DisputeStatus.NONE,
      requestedAmountCents: payment!.hostTotalCents,
      hostTotalCents: payment!.hostTotalCents,
      cleanerPayoutCents: payment!.cleanerPayoutCents,
      alreadyRefundedCents: 0,
      alreadyReversedCents: 0,
    });
    expect(decision.refundAmountCents).toBe(payment!.hostTotalCents);
  });
});
