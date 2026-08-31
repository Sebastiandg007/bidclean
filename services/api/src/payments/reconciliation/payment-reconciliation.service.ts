import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type Stripe from 'stripe';
import { StripeClient } from '../stripe/stripe.client';
import { PaymentsRepository } from '../payments.repository';
import { DisputeService } from '../disputes/dispute.service';
import { extractStripeFeeCents } from '../stripe/stripe-fee.util';
import { PAYMENTS_RECONCILE_INTERVAL_MS } from '../payments.constants';
import { AttemptStatus, DisputeStatus } from '../payments.types';

/** Max payments reconciled per sweep */
const RECONCILE_BATCH_SIZE = 50;

/** Intent statuses that are non-terminal (still in flight) and must not fail the payment */
const NON_TERMINAL_INTENT_STATUSES = ['requires_action', 'requires_confirmation', 'processing'];

/** Stripe dispute statuses that are terminal resolutions */
const DISPUTE_WON_STATUS = 'won';
const DISPUTE_LOST_STATUS = 'lost';

/** Outcome flags for DisputeService.closeDispute — named to keep call sites self-explanatory. */
const DISPUTE_OUTCOME_WON = true;
const DISPUTE_OUTCOME_LOST = false;

/**
 * Payment reconciliation service.
 *
 * Periodic safety net behind webhooks (P11). Two sweeps run on the same interval:
 *
 * 1. Charge reconciliation — for payments stuck in PROCESSING, retrieve the latest
 *    attempt's PaymentIntent from Stripe and repair persisted state: succeeded -> HELD
 *    (record fee), terminal-failure -> FAILED. Non-terminal intents (requires_action /
 *    processing) are left PROCESSING and logged so aged rows are visible for alerting.
 *
 * 2. Dispute reconciliation — the `charge.dispute.*` webhook is the ONLY dispute signal
 *    and has no other backstop, so this sweep converges `dispute_status` to Stripe:
 *    it opens disputes Stripe reports but whose webhook was missed (pausing auto-release,
 *    P5) and closes disputes resolved as won/lost. The formal evidence workflow remains
 *    owned by the future dispute-system spec; this only reconciles the status.
 */
@Injectable()
export class PaymentReconciliationService {
  private readonly logger = new Logger(PaymentReconciliationService.name);

  constructor(
    private readonly stripe: StripeClient,
    private readonly repo: PaymentsRepository,
    private readonly disputes: DisputeService,
  ) {}

  /** Sweep interval resolved from configuration. */
  static getInterval(): number {
    return PAYMENTS_RECONCILE_INTERVAL_MS;
  }

  /** Run both reconciliation sweeps (charges + disputes). */
  @Interval(PaymentReconciliationService.getInterval())
  async sweep(): Promise<void> {
    await this.reconcileCharges();
    await this.reconcileDisputes();
  }

  /** Reconcile PROCESSING payments against Stripe. */
  async reconcileCharges(): Promise<void> {
    try {
      const stuck = await this.repo.findProcessingPayments(RECONCILE_BATCH_SIZE);
      for (const payment of stuck) {
        await this.reconcilePayment(payment.id);
      }
    } catch (error) {
      this.logger.error(`Charge reconciliation sweep failed: ${String(error)}`);
    }
  }

  /**
   * Reconcile dispute status against Stripe for charged payments. Detects both
   * unprocessed `charge.dispute.created` (dispute NONE but Stripe shows an open dispute)
   * and unprocessed `charge.dispute.closed` (dispute OPEN but Stripe resolved it).
   */
  async reconcileDisputes(): Promise<void> {
    try {
      // Newly opened disputes the webhook may have missed.
      const undisputed = await this.repo.findChargedPaymentsForDisputeCheck(
        [DisputeStatus.NONE],
        RECONCILE_BATCH_SIZE,
      );
      for (const row of undisputed) {
        await this.reconcileDisputeForCharge(row.paymentId, row.stripeChargeId);
      }

      // Open disputes whose closure the webhook may have missed.
      const open = await this.repo.findChargedPaymentsForDisputeCheck(
        [DisputeStatus.OPEN],
        RECONCILE_BATCH_SIZE,
      );
      for (const row of open) {
        await this.reconcileDisputeForCharge(row.paymentId, row.stripeChargeId);
      }
    } catch (error) {
      this.logger.error(`Dispute reconciliation sweep failed: ${String(error)}`);
    }
  }

  /** Reconcile a single payment's latest attempt against its Stripe intent. */
  async reconcilePayment(paymentId: string): Promise<void> {
    const attempts = await this.repo.listAttempts(paymentId);
    const latest = attempts[attempts.length - 1];
    if (!latest || latest.status !== AttemptStatus.PROCESSING) {
      return;
    }
    const intent = await this.resolveIntentForAttempt(paymentId, latest.stripePaymentIntentId);
    if (!intent) {
      return;
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
    } else if (intent.status === 'canceled' || intent.status === 'requires_payment_method') {
      await this.repo.markChargeFailed({
        paymentId,
        attemptId: latest.id,
        failureReason: `Reconciled from Stripe intent status ${intent.status}`,
      });
      this.logger.log(`Reconciled payment ${paymentId} -> FAILED`);
    } else if (NON_TERMINAL_INTENT_STATUSES.includes(intent.status)) {
      // Still in flight (e.g. off-session action required). Leave PROCESSING and surface
      // it so an aged row can be alerted on / manually resolved rather than silently stuck.
      this.logger.warn(
        `Payment ${paymentId} intent still non-terminal (${intent.status}); leaving PROCESSING for the next sweep`,
      );
    } else {
      this.logger.warn(
        `Payment ${paymentId} intent in unhandled status ${intent.status}; leaving PROCESSING`,
      );
    }
  }

  /**
   * Resolve the Stripe intent for an attempt. Normally the attempt holds the real intent id;
   * a `pending:` placeholder means the process crashed between the Stripe charge and the DB
   * write, so fall back to finding the intent by `metadata.paymentId` (P11 — no stranded
   * charge). Returns null when a placeholder has no Stripe match yet (retry next sweep).
   */
  private async resolveIntentForAttempt(
    paymentId: string,
    stripePaymentIntentId: string,
  ): Promise<Stripe.PaymentIntent | null> {
    if (!stripePaymentIntentId.startsWith('pending:')) {
      return this.stripe.retrievePaymentIntent(stripePaymentIntentId);
    }
    const intent = await this.stripe.findPaymentIntentByPaymentId(paymentId);
    if (!intent) {
      this.logger.warn(
        `Payment ${paymentId} is PROCESSING with an unresolved intent (no Stripe match yet); will retry next sweep`,
      );
    }
    return intent;
  }

  /** Open or close the dispute for one charged payment based on Stripe's dispute list. */
  private async reconcileDisputeForCharge(
    paymentId: string,
    stripeChargeId: string,
  ): Promise<void> {
    const disputes = await this.stripe.listDisputesForCharge(stripeChargeId);
    if (disputes.length === 0) {
      return;
    }
    // Use the most recent dispute for the charge.
    const dispute = disputes[0];
    if (!dispute) {
      return;
    }

    if (dispute.status === DISPUTE_WON_STATUS) {
      await this.disputes.closeDispute(paymentId, DISPUTE_OUTCOME_WON);
    } else if (dispute.status === DISPUTE_LOST_STATUS) {
      await this.disputes.closeDispute(paymentId, DISPUTE_OUTCOME_LOST);
    } else {
      // Any other status (needs_response, under_review, warning_*) means the dispute is
      // still open — ensure auto-release is paused (idempotent if already OPEN).
      await this.disputes.openDispute(paymentId);
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
