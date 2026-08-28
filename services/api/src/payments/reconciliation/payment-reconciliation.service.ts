import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { StripeClient } from '../stripe/stripe.client';
import { PaymentsRepository } from '../payments.repository';
import { extractStripeFeeCents } from '../stripe/stripe-fee.util';
import { PAYMENTS_RECONCILE_INTERVAL_MS } from '../payments.constants';
import { AttemptStatus } from '../payments.types';

/** Max payments reconciled per sweep */
const RECONCILE_BATCH_SIZE = 50;

/**
 * Payment reconciliation service.
 *
 * Periodic safety net behind webhooks (P11). For payments stuck in PROCESSING, it
 * retrieves the latest attempt's PaymentIntent from Stripe and repairs persisted
 * state: succeeded -> HELD (record fee), failed -> FAILED. Convergence to Stripe's
 * truth without distributed transactions.
 */
@Injectable()
export class PaymentReconciliationService {
  private readonly logger = new Logger(PaymentReconciliationService.name);

  constructor(
    private readonly stripe: StripeClient,
    private readonly repo: PaymentsRepository,
  ) {}

  /** Sweep interval resolved from configuration. */
  static getInterval(): number {
    return PAYMENTS_RECONCILE_INTERVAL_MS;
  }

  /** Reconcile PROCESSING payments against Stripe. */
  @Interval(PaymentReconciliationService.getInterval())
  async sweep(): Promise<void> {
    try {
      const stuck = await this.repo.findProcessingPayments(RECONCILE_BATCH_SIZE);
      for (const payment of stuck) {
        await this.reconcilePayment(payment.id);
      }
    } catch (error) {
      this.logger.error(`Payment reconciliation sweep failed: ${String(error)}`);
    }
  }

  /** Reconcile a single payment's latest attempt against its Stripe intent. */
  async reconcilePayment(paymentId: string): Promise<void> {
    const attempts = await this.repo.listAttempts(paymentId);
    const latest = attempts[attempts.length - 1];
    if (!latest || latest.status !== AttemptStatus.PROCESSING) {
      return;
    }
    if (latest.stripePaymentIntentId.startsWith('pending:')) {
      // The intent id was never persisted (crash before creation) — nothing to query.
      return;
    }

    const intent = await this.stripe.retrievePaymentIntent(latest.stripePaymentIntentId);
    if (intent.status === 'succeeded') {
      await this.repo.markChargeSucceeded({
        paymentId,
        attemptId: latest.id,
        stripeChargeId: this.resolveChargeId(intent),
        stripeFeeCents: extractStripeFeeCents(intent),
      });
      this.logger.log(`Reconciled payment ${paymentId} -> HELD`);
    } else if (
      intent.status === 'canceled' ||
      intent.status === 'requires_payment_method'
    ) {
      await this.repo.markChargeFailed({
        paymentId,
        attemptId: latest.id,
        failureReason: `Reconciled from Stripe intent status ${intent.status}`,
      });
      this.logger.log(`Reconciled payment ${paymentId} -> FAILED`);
    }
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
