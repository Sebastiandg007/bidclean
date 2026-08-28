import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { StripeClient } from '../stripe/stripe.client';
import { PaymentsRepository } from '../payments.repository';
import { PaymentPublisher } from '../events/payment-publisher.service';
import { stripeIdempotency } from '../stripe/stripe-idempotency';
import { sanitizeStripePayload } from '../payment-payload.sanitizer';
import {
  DisputeStatus,
  PaymentEventSource,
  PaymentStatus,
  PayoutStatus,
  ReleaseReason,
} from '../payments.types';
import { STRIPE_WEBHOOK_EVENTS } from '../stripe/stripe.constants';

/**
 * Escrow release service.
 *
 * Releases a held payment to the Cleaner. If the Cleaner is not yet payout-enabled,
 * the release is deferred (payout_status = PENDING, no Transfer) per the payout gate
 * (P6). Otherwise a Transfer is created with a deterministic idempotency key so
 * concurrent triggers yield at most one Transfer (P4). Keeps the platform commission
 * on the platform balance. Never runs while a dispute is OPEN.
 */
@Injectable()
export class EscrowReleaseService {
  private readonly logger = new Logger(EscrowReleaseService.name);

  constructor(
    private readonly stripe: StripeClient,
    private readonly repo: PaymentsRepository,
    private readonly publisher: PaymentPublisher,
  ) {}

  /**
   * Release a payment's payout.
   *
   * @param paymentId - The payment to release
   * @param reason - Why the release was triggered (confirm / auto / deferred)
   */
  async release(paymentId: string, reason: ReleaseReason): Promise<void> {
    const payment = await this.repo.findPaymentById(paymentId);
    if (!payment) {
      throw new NotFoundException(`Payment ${paymentId} not found`);
    }

    // Only HELD / PARTIALLY_REFUNDED payments are releasable, and never while disputed.
    const releasableStatuses: string[] = [PaymentStatus.HELD, PaymentStatus.PARTIALLY_REFUNDED];
    if (!releasableStatuses.includes(payment.paymentStatus)) {
      throw new ConflictException(
        `Payment ${paymentId} is not releasable in status ${payment.paymentStatus}`,
      );
    }
    if (payment.disputeStatus === DisputeStatus.OPEN) {
      throw new ConflictException(`Payment ${paymentId} cannot be released while disputed`);
    }

    // Already released? Nothing to do (idempotent, P4).
    if (
      payment.payoutStatus === PayoutStatus.TRANSFER_CREATED ||
      payment.payoutStatus === PayoutStatus.PAID
    ) {
      return;
    }

    const account = await this.repo.findAccountByCleaner(payment.cleanerId);
    const payoutEnabled = account?.payoutsEnabled === true;

    if (!payoutEnabled) {
      // Payout gate (P6): defer until the account becomes eligible.
      if (payment.payoutStatus !== PayoutStatus.PENDING) {
        await this.repo.markPayoutDeferred(paymentId);
      }
      this.logger.debug(`Release deferred for payment ${paymentId} (payouts not enabled)`);
      return;
    }

    // Create the payout Transfer. Idempotency key ensures a single Transfer (P4).
    const transfer = await this.stripe.createTransfer(
      {
        amount: payment.cleanerPayoutCents,
        currency: payment.currency.toLowerCase(),
        destination: account!.stripeAccountId,
        metadata: { paymentId, offerId: payment.offerId, reason },
      },
      stripeIdempotency.release(paymentId),
    );

    await this.repo.markReleased({ paymentId, stripeTransferId: transfer.id });

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

    this.logger.log(`Released payment ${paymentId} (${reason}) transfer ${transfer.id}`);
  }

  /** Release all payments deferred for a Cleaner who just became payout-eligible (P6). */
  async releaseDeferredForCleaner(cleanerId: string): Promise<number> {
    const pending = await this.repo.findPendingPayoutsForCleaner(cleanerId);
    let released = 0;
    for (const payment of pending) {
      try {
        await this.release(payment.id, ReleaseReason.DEFERRED_ONBOARDING);
        released += 1;
      } catch (error) {
        this.logger.error(`Deferred release failed for payment ${payment.id}: ${String(error)}`);
      }
    }
    return released;
  }
}
