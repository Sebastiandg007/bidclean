import { Injectable, Logger } from '@nestjs/common';
import { CommissionService } from '../../offers/commission/commission.service';
import { StripeClient } from '../stripe/stripe.client';
import { PaymentsRepository } from '../payments.repository';
import { PaymentPublisher } from '../events/payment-publisher.service';
import { stripeIdempotency } from '../stripe/stripe-idempotency';
import { sanitizeStripePayload } from '../payment-payload.sanitizer';
import { PaymentEventSource } from '../payments.types';
import { STRIPE_WEBHOOK_EVENTS } from '../stripe/stripe.constants';
import { extractStripeFeeCents } from '../stripe/stripe-fee.util';

/** The matched-offer context needed to charge */
export interface ChargeContext {
  readonly offerId: string;
  readonly hostId: string;
  readonly cleanerId: string;
}

/**
 * Escrow charge service.
 *
 * On `offer.matched`, resolves the agreed price, computes the breakdown via
 * CommissionService, creates the payment + attempt, and charges the Host with a
 * deterministic idempotency key so concurrent deliveries yield a single charge (P3).
 * On success: HELD + fee recorded + `payment.captured`. On failure: FAILED +
 * `payment.failed` (offer-publishing decides the offer's next state). The module
 * never writes the offers table.
 */
@Injectable()
export class EscrowChargeService {
  private readonly logger = new Logger(EscrowChargeService.name);

  constructor(
    private readonly commission: CommissionService,
    private readonly stripe: StripeClient,
    private readonly repo: PaymentsRepository,
    private readonly publisher: PaymentPublisher,
  ) {}

  /**
   * Charge the Host for a matched offer. Idempotent on the offer: a payment already
   * HELD/RELEASED short-circuits.
   */
  async chargeForOffer(ctx: ChargeContext): Promise<void> {
    const existing = await this.repo.findPaymentByOffer(ctx.offerId);
    if (existing && this.isAlreadyCharged(existing.paymentStatus)) {
      this.logger.debug(`Offer ${ctx.offerId} already charged (${existing.paymentStatus})`);
      return;
    }

    const rates = await this.repo.findOfferRates(ctx.offerId);
    const agreedPrice = await this.repo.resolveAgreedPriceCents(ctx.offerId);
    if (!rates || agreedPrice === null) {
      this.logger.error(`Cannot charge offer ${ctx.offerId}: missing offer rates or price`);
      return;
    }

    const breakdown = this.commission.getFullBreakdown(
      agreedPrice,
      rates.hostServiceFeeRateBps,
      rates.cleanerCommissionRateBps,
    );

    const { payment, attempt } = await this.repo.createPaymentWithAttempt(
      {
        offerId: ctx.offerId,
        hostId: ctx.hostId,
        cleanerId: ctx.cleanerId,
        snapshot: {
          agreedPriceCents: agreedPrice,
          hostTotalCents: breakdown.hostTotalCents,
          cleanerPayoutCents: breakdown.cleanerPayoutCents,
          platformGrossRevenueCents: breakdown.hostTotalCents - breakdown.cleanerPayoutCents,
          currency: rates.currency,
        },
      },
      // PaymentIntent id is unknown before creation; use a deterministic placeholder
      // keyed to the attempt via the idempotency key, then reconcile the real id.
      `pending:${ctx.offerId}:${Date.now()}`,
      breakdown.hostTotalCents,
    );

    try {
      const intent = await this.stripe.createPaymentIntent(
        {
          amount: breakdown.hostTotalCents,
          currency: rates.currency.toLowerCase(),
          confirm: true,
          off_session: true,
          metadata: {
            offerId: ctx.offerId,
            paymentId: payment.id,
            attemptId: attempt.id,
          },
        },
        stripeIdempotency.charge(ctx.offerId, attempt.attemptNumber),
      );

      const stripeFeeCents = extractStripeFeeCents(intent);
      await this.repo.markChargeSucceeded({
        paymentId: payment.id,
        attemptId: attempt.id,
        stripeChargeId: this.resolveChargeId(intent),
        stripeFeeCents,
      });

      await this.repo.appendEvent({
        paymentId: payment.id,
        source: PaymentEventSource.API,
        eventType: STRIPE_WEBHOOK_EVENTS.PAYMENT_INTENT_SUCCEEDED,
        idempotencyKey: stripeIdempotency.charge(ctx.offerId, attempt.attemptNumber),
        amountCents: breakdown.hostTotalCents,
        currency: rates.currency,
        payload: sanitizeStripePayload({
          id: intent.id,
          type: STRIPE_WEBHOOK_EVENTS.PAYMENT_INTENT_SUCCEEDED,
          data: { object: intent as unknown as Record<string, unknown> },
        }),
      });

      this.publisher.emitCaptured({
        paymentId: payment.id,
        offerId: ctx.offerId,
        hostId: ctx.hostId,
        cleanerId: ctx.cleanerId,
        hostTotalCents: breakdown.hostTotalCents,
        currency: rates.currency,
      });

      this.logger.log(`Charged offer ${ctx.offerId} -> HELD (payment ${payment.id})`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.repo.markChargeFailed({
        paymentId: payment.id,
        attemptId: attempt.id,
        failureReason: reason,
      });

      this.publisher.emitFailed({
        paymentId: payment.id,
        offerId: ctx.offerId,
        hostId: ctx.hostId,
        cleanerId: ctx.cleanerId,
        failureReason: reason,
      });

      this.logger.warn(`Charge failed for offer ${ctx.offerId}: ${reason}`);
    }
  }

  private isAlreadyCharged(status: string): boolean {
    return ['PROCESSING', 'HELD', 'RELEASED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(status);
  }

  private resolveChargeId(intent: { latest_charge?: unknown }): string {
    const latest = intent.latest_charge;
    if (typeof latest === 'string') {
      return latest;
    }
    if (latest && typeof latest === 'object' && 'id' in latest) {
      return String((latest as { id: unknown }).id);
    }
    return '';
  }
}
