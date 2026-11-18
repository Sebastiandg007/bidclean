import { Injectable, Logger } from '@nestjs/common';

import { PaymentsRepository } from '../payments.repository';
import { StripeClient } from '../stripe/stripe.client';
import { PaymentPublisher } from '../events/payment-publisher.service';
import { computeProportionalReversal } from '../refund-policy';
import { stripeIdempotency } from '../stripe/stripe-idempotency';
import { sanitizeStripePayload } from '../payment-payload.sanitizer';
import { STRIPE_WEBHOOK_EVENTS } from '../stripe/stripe.constants';
import {
  DisputeEffectBlockedReason,
  DisputeEffectOutcome,
  DisputeEffectResult,
  PaymentEventSource,
  PaymentStatus,
  PayoutStatus,
  ReleaseReason,
} from '../payments.types';
import { Payment } from '../entities/payment.entity';

/**
 * DisputeSettlementService — the ONLY dispute-driven money path in Spec 9 (Spec 21 contract).
 *
 * The dispute-system module (Spec 21) drives money exclusively through this service via its thin
 * EscrowClient. Unlike `RefundService.refund` / `EscrowReleaseService.release` (which BLOCK while a
 * dispute is OPEN, by design), these methods are dispute-AUTHORIZED: the dispute IS the authority,
 * and it deliberately holds the escrow block OPEN until the effect lands (clear-escrow-LAST). Money
 * math is NOT reimplemented — it reuses `computeProportionalReversal` + the Stripe seam + the same
 * ceilings the repository CHECKs enforce.
 *
 * Three additive guarantees (all inside Spec 9's money authority):
 *  (b) FAVOR_CLEANER + POST_RELEASE (already paid) → accepted `NO_OP`.
 *  (c) A payment already dispute-settled → `BLOCKED` (`PAYMENT_ALREADY_SETTLED`), so at most one
 *      dispute-driven financial effect ever lands per payment (P15). The settlement is claimed under
 *      the payment row lock BEFORE any Stripe call, so it is single-winner across sequential disputes.
 *  Ceiling handling → `CEILING_CLAMPED` (applied, `effectiveAmountCents` = clamped) or `BLOCKED`
 *      when nothing is refundable.
 */
@Injectable()
export class DisputeSettlementService {
  private readonly logger = new Logger(DisputeSettlementService.name);

  constructor(
    private readonly repo: PaymentsRepository,
    private readonly stripe: StripeClient,
    private readonly publisher: PaymentPublisher,
  ) {}

  /**
   * Release the held funds to the Cleaner for a FAVOR_CLEANER resolution. POST_RELEASE (already
   * paid) is an accepted `NO_OP`. Claims the P15 settlement first; a second dispute effect → BLOCKED.
   */
  async releaseForDispute(paymentId: string): Promise<DisputeEffectOutcome> {
    const payment = await this.repo.findPaymentById(paymentId);
    if (!payment) {
      return this.blocked(DisputeEffectBlockedReason.PAYMENT_NOT_FOUND);
    }

    // Contract (b): already paid out → nothing to move; accepted no-op (idempotent, not settled-claimed).
    if (this.isPostRelease(payment.payoutStatus)) {
      return { result: DisputeEffectResult.NO_OP, effectiveAmountCents: 0 };
    }

    // Contract (c) / P15: claim the single dispute-driven effect for this payment.
    const claimed = await this.repo.claimDisputeSettlement(paymentId);
    if (!claimed) {
      return this.blocked(DisputeEffectBlockedReason.PAYMENT_ALREADY_SETTLED);
    }

    const account = await this.repo.findAccountByCleaner(payment.cleanerId);
    if (account?.payoutsEnabled !== true) {
      // Payout gate: defer (payout_status PENDING). Still an APPLIED dispute effect (command accepted).
      if (payment.payoutStatus !== PayoutStatus.PENDING) {
        await this.repo.markPayoutDeferred(paymentId);
      }
      return { result: DisputeEffectResult.APPLIED, effectiveAmountCents: 0 };
    }

    const transfer = await this.stripe.createTransfer(
      {
        amount: payment.cleanerPayoutCents,
        currency: payment.currency.toLowerCase(),
        destination: account.stripeAccountId,
        metadata: { paymentId, offerId: payment.offerId, reason: ReleaseReason.HOST_CONFIRMED },
      },
      stripeIdempotency.release(paymentId),
    );

    await this.repo.markReleasedForDispute(paymentId, transfer.id);
    await this.repo.appendEvent({
      paymentId,
      source: PaymentEventSource.API,
      eventType: STRIPE_WEBHOOK_EVENTS.TRANSFER_CREATED,
      idempotencyKey: stripeIdempotency.release(paymentId),
      amountCents: payment.cleanerPayoutCents,
      currency: payment.currency,
      payload: sanitizeStripePayload({
        id: transfer.id,
        type: STRIPE_WEBHOOK_EVENTS.TRANSFER_CREATED,
        data: { object: transfer as unknown as Record<string, unknown> },
      }),
    });
    this.publisher.emitReleased({
      paymentId,
      offerId: payment.offerId,
      hostId: payment.hostId,
      cleanerId: payment.cleanerId,
      cleanerPayoutCents: payment.cleanerPayoutCents,
      currency: payment.currency,
    });
    this.logger.log(`Dispute release applied for payment ${paymentId}`);
    return { result: DisputeEffectResult.APPLIED, effectiveAmountCents: payment.cleanerPayoutCents };
  }

  /**
   * Refund the Host (full when `amountCents` is null, else partial) for a FAVOR_HOST/PARTIAL
   * resolution, adding the proportional Transfer Reversal when POST_RELEASE. Claims the P15
   * settlement first; a second dispute effect → BLOCKED. A requested amount over the remaining
   * refundable is clamped → `CEILING_CLAMPED`; nothing refundable → `BLOCKED`.
   */
  async refundForDispute(
    paymentId: string,
    amountCents: number | null,
  ): Promise<DisputeEffectOutcome> {
    const payment = await this.repo.findPaymentById(paymentId);
    if (!payment) {
      return this.blocked(DisputeEffectBlockedReason.PAYMENT_NOT_FOUND);
    }

    const remaining = payment.hostTotalCents - payment.refundedAmountCents;
    if (remaining <= 0) {
      return this.blocked(DisputeEffectBlockedReason.NOTHING_REFUNDABLE);
    }

    const requested = amountCents ?? remaining;
    const clamped = Math.max(0, Math.min(requested, remaining));
    if (clamped <= 0) {
      return this.blocked(DisputeEffectBlockedReason.NOTHING_REFUNDABLE);
    }

    // Contract (c) / P15: claim the single dispute-driven effect BEFORE any Stripe call.
    const claimedSettlement = await this.repo.claimDisputeSettlement(paymentId);
    if (!claimedSettlement) {
      return this.blocked(DisputeEffectBlockedReason.PAYMENT_ALREADY_SETTLED);
    }

    const reversal = this.resolveReversal(payment, clamped);
    if (reversal > 0 && payment.stripeTransferId) {
      const reversalResult = await this.stripe.createTransferReversal(
        payment.stripeTransferId,
        { amount: reversal },
        stripeIdempotency.reversal(payment.id, `dispute:${payment.id}`),
      );
      await this.repo.appendEvent({
        paymentId: payment.id,
        source: PaymentEventSource.API,
        eventType: STRIPE_WEBHOOK_EVENTS.TRANSFER_REVERSED,
        idempotencyKey: stripeIdempotency.reversal(payment.id, `dispute:${payment.id}`),
        amountCents: reversal,
        currency: payment.currency,
        payload: sanitizeStripePayload({
          id: reversalResult.id,
          type: STRIPE_WEBHOOK_EVENTS.TRANSFER_REVERSED,
          data: { object: reversalResult as unknown as Record<string, unknown> },
        }),
      });
    }

    const refund = await this.stripe.createRefund(
      { amount: clamped, metadata: { paymentId: payment.id, offerId: payment.offerId } },
      stripeIdempotency.refund(payment.id, `dispute:${payment.id}`),
    );
    const resultingStatus =
      payment.refundedAmountCents + clamped >= payment.hostTotalCents
        ? PaymentStatus.REFUNDED
        : PaymentStatus.PARTIALLY_REFUNDED;

    await this.repo.applyRefund({
      paymentId: payment.id,
      refundAmountCents: clamped,
      reversalAmountCents: reversal,
      resultingStatus,
    });
    await this.repo.appendEvent({
      paymentId: payment.id,
      source: PaymentEventSource.API,
      eventType: STRIPE_WEBHOOK_EVENTS.CHARGE_REFUNDED,
      idempotencyKey: stripeIdempotency.refund(payment.id, `dispute:${payment.id}`),
      amountCents: clamped,
      currency: payment.currency,
      payload: sanitizeStripePayload({
        id: refund.id,
        type: STRIPE_WEBHOOK_EVENTS.CHARGE_REFUNDED,
        data: { object: refund as unknown as Record<string, unknown> },
      }),
    });
    this.publisher.emitRefunded({
      paymentId: payment.id,
      offerId: payment.offerId,
      hostId: payment.hostId,
      cleanerId: payment.cleanerId,
      refundAmountCents: clamped,
      reversalAmountCents: reversal,
      currency: payment.currency,
    });
    this.logger.log(`Dispute refund applied for payment ${paymentId}: refund=${clamped} reversal=${reversal}`);

    const result =
      clamped < requested ? DisputeEffectResult.CEILING_CLAMPED : DisputeEffectResult.APPLIED;
    return { result, effectiveAmountCents: clamped };
  }

  /** The proportional Cleaner reversal for a post-release dispute refund (0 pre-release). */
  private resolveReversal(payment: Payment, refundAmountCents: number): number {
    if (!this.isPostRelease(payment.payoutStatus)) {
      return 0;
    }
    const raw = computeProportionalReversal(
      refundAmountCents,
      payment.hostTotalCents,
      payment.cleanerPayoutCents,
    );
    const reversalRemaining = payment.cleanerPayoutCents - payment.reversedAmountCents;
    return Math.max(0, Math.min(raw, reversalRemaining));
  }

  /** Whether the payout has already moved off the platform balance. */
  private isPostRelease(payoutStatus: string): boolean {
    return payoutStatus === PayoutStatus.TRANSFER_CREATED || payoutStatus === PayoutStatus.PAID;
  }

  /** Build a BLOCKED outcome with a sanitized reason. */
  private blocked(reason: DisputeEffectBlockedReason): DisputeEffectOutcome {
    return { result: DisputeEffectResult.BLOCKED, reason };
  }
}
