import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { StripeClient } from '../stripe/stripe.client';
import { PaymentsRepository } from '../payments.repository';
import { PaymentPublisher } from '../events/payment-publisher.service';
import { decideRefund } from '../refund-policy';
import { stripeIdempotency } from '../stripe/stripe-idempotency';
import { sanitizeStripePayload } from '../payment-payload.sanitizer';
import {
  DisputeStatus,
  PaymentEventSource,
  PaymentStatus,
  PayoutStatus,
} from '../payments.types';
import { STRIPE_WEBHOOK_EVENTS } from '../stripe/stripe.constants';
import { PaymentView } from '../payments.types';
import { toPaymentView } from '../payments.mapper';

/** Refund request payload */
export interface RefundRequest {
  /** Requested amount in cents; omit for a full refund of the remaining amount */
  readonly amountCents?: number;
}

/**
 * Refund service.
 *
 * Authorizes the Host owner, applies the pure refund policy, and performs the
 * required Stripe operations: a Refund pre-release, or a Transfer Reversal + Refund
 * post-release. Enforces the refund/reversal ceilings (422) and blocks refunds while
 * a dispute is open (409). The Stripe fee is absorbed by the platform.
 */
@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly stripe: StripeClient,
    private readonly repo: PaymentsRepository,
    private readonly publisher: PaymentPublisher,
  ) {}

  /**
   * Refund a payment (full or partial), applying a Transfer Reversal when the payout
   * has already been transferred.
   */
  async refund(
    hostId: string,
    offerId: string,
    request: RefundRequest,
    idempotencyKey: string,
  ): Promise<PaymentView> {
    const payment = await this.repo.findPaymentByOffer(offerId);
    if (!payment) {
      throw new NotFoundException(`No payment found for offer ${offerId}`);
    }
    if (payment.hostId !== hostId) {
      throw new ForbiddenException('Only the Host owner can request a refund');
    }

    const decision = decideRefund({
      paymentStatus: payment.paymentStatus as PaymentStatus,
      payoutStatus: payment.payoutStatus as PayoutStatus,
      disputeStatus: payment.disputeStatus as DisputeStatus,
      requestedAmountCents: request.amountCents,
      hostTotalCents: payment.hostTotalCents,
      cleanerPayoutCents: payment.cleanerPayoutCents,
      alreadyRefundedCents: payment.refundedAmountCents,
      alreadyReversedCents: payment.reversedAmountCents,
    });

    if (decision.blocked) {
      // Disputed -> 409; ceiling/validation -> 422.
      if (payment.disputeStatus === DisputeStatus.OPEN) {
        throw new ConflictException(decision.reason ?? 'Refund blocked by open dispute');
      }
      throw new UnprocessableEntityException(decision.reason ?? 'Refund not allowed');
    }

    // Post-release: reverse the Cleaner's proportional share first.
    if (decision.reversalAmountCents > 0 && payment.stripeTransferId) {
      const reversal = await this.stripe.createTransferReversal(
        payment.stripeTransferId,
        { amount: decision.reversalAmountCents },
        stripeIdempotency.reversal(payment.id, idempotencyKey),
      );
      await this.repo.appendEvent({
        paymentId: payment.id,
        source: PaymentEventSource.API,
        eventType: STRIPE_WEBHOOK_EVENTS.TRANSFER_REVERSED,
        idempotencyKey: stripeIdempotency.reversal(payment.id, idempotencyKey),
        amountCents: decision.reversalAmountCents,
        currency: payment.currency,
        payload: sanitizeStripePayload({
          id: reversal.id,
          type: STRIPE_WEBHOOK_EVENTS.TRANSFER_REVERSED,
          data: { object: reversal as unknown as Record<string, unknown> },
        }),
      });
    }

    const refund = await this.stripe.createRefund(
      { amount: decision.refundAmountCents, metadata: { paymentId: payment.id, offerId } },
      stripeIdempotency.refund(payment.id, idempotencyKey),
    );

    const resultingStatus = this.resolveResultingStatus(
      payment.hostTotalCents,
      payment.refundedAmountCents + decision.refundAmountCents,
    );

    await this.repo.applyRefund({
      paymentId: payment.id,
      refundAmountCents: decision.refundAmountCents,
      reversalAmountCents: decision.reversalAmountCents,
      resultingStatus,
    });

    await this.repo.appendEvent({
      paymentId: payment.id,
      source: PaymentEventSource.API,
      eventType: STRIPE_WEBHOOK_EVENTS.CHARGE_REFUNDED,
      idempotencyKey: stripeIdempotency.refund(payment.id, idempotencyKey),
      amountCents: decision.refundAmountCents,
      currency: payment.currency,
      payload: sanitizeStripePayload({
        id: refund.id,
        type: STRIPE_WEBHOOK_EVENTS.CHARGE_REFUNDED,
        data: { object: refund as unknown as Record<string, unknown> },
      }),
    });

    this.publisher.emitRefunded({
      paymentId: payment.id,
      offerId,
      hostId: payment.hostId,
      cleanerId: payment.cleanerId,
      refundAmountCents: decision.refundAmountCents,
      reversalAmountCents: decision.reversalAmountCents,
      currency: payment.currency,
    });

    this.logger.log(
      `Refunded payment ${payment.id}: refund=${decision.refundAmountCents} reversal=${decision.reversalAmountCents}`,
    );

    const updated = await this.repo.findPaymentById(payment.id);
    return toPaymentView(updated!);
  }

  /** Full refund -> REFUNDED; otherwise PARTIALLY_REFUNDED. */
  private resolveResultingStatus(hostTotalCents: number, totalRefunded: number): PaymentStatus {
    return totalRefunded >= hostTotalCents
      ? PaymentStatus.REFUNDED
      : PaymentStatus.PARTIALLY_REFUNDED;
  }
}
