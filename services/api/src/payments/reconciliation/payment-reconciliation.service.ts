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
    // Resolve the intent. Normally the attempt holds the real intent id; a `pending:`
    // placeholder means the process crashed between the Stripe charge and the DB write,
    // so fall back to finding the intent by `metadata.paymentId` (P11 — no stranded charge).
    let intent = null;
    if (latest.stripePaymentIntentId.startsWith('pending:')) {
      intent = await this.stripe.findPaymentIntentByPaymentId(paymentId);
      if (!intent) {
        this.logger.warn(
          `Payment ${paymentId} is PROCESSING with an unresolved intent (no Stripe match yet); will retry next sweep`,
        );
        return;
      }
    } else {
      intent = await this.stripe.retrievePaymentIntent(latest.stripePaymentIntentId);
    }
    if (intent.status === 'succeeded') {
      await this.repo.markChargeSucceeded({
        paymentId,
        attemptId: latest.id,
        // Use the resolved intent's real id (heals a `pending:` placeholder).
        stripePaymentIntentId: intent.id,
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
