import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PaymentsRepository } from '../payments.repository';
import { DisputeService } from '../disputes/dispute.service';
import { ConnectReconciliationService } from '../connect/connect-reconciliation.service';
import { STRIPE_WEBHOOK_EVENTS } from '../stripe/stripe.constants';
import { PAYMENTS_QUEUE_NAMES } from '../payments.constants';
import { PayoutStatus } from '../payments.types';
import { SanitizedPayload } from '../payment-payload.sanitizer';

/** Job payload enqueued by the webhook controller */
interface WebhookJobData {
  readonly stripeEventId: string;
  readonly eventType: string;
  readonly sanitized: SanitizedPayload;
}

/**
 * Stripe webhook processor (BullMQ).
 *
 * Dispatches persisted webhook events by type: charge success/failure, refunds,
 * transfer status, disputes, and account capability updates. Retry + backoff are
 * configured on the queue (exhausted jobs go to the dead-letter, so no event is lost).
 * Reconciliation sweeps provide a second convergence path (P11).
 */
@Processor(PAYMENTS_QUEUE_NAMES.WEBHOOK)
export class StripeWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(StripeWebhookProcessor.name);

  constructor(
    private readonly repo: PaymentsRepository,
    private readonly disputes: DisputeService,
    private readonly connectReconciliation: ConnectReconciliationService,
  ) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    const { eventType, sanitized } = job.data;
    switch (eventType) {
      case STRIPE_WEBHOOK_EVENTS.TRANSFER_PAID:
        await this.onTransferStatus(sanitized, PayoutStatus.PAID);
        break;
      case STRIPE_WEBHOOK_EVENTS.TRANSFER_REVERSED:
        await this.onTransferStatus(sanitized, PayoutStatus.REVERSED);
        break;
      case STRIPE_WEBHOOK_EVENTS.DISPUTE_CREATED:
        await this.onDisputeCreated(sanitized);
        break;
      case STRIPE_WEBHOOK_EVENTS.DISPUTE_CLOSED:
        await this.onDisputeClosed(sanitized);
        break;
      case STRIPE_WEBHOOK_EVENTS.ACCOUNT_UPDATED:
        await this.onAccountUpdated(sanitized);
        break;
      default:
        // payment_intent.*, charge.refunded, transfer.created are recorded and
        // reconciled by the sweeps; no additional processing needed here.
        this.logger.debug(`No processor branch for ${eventType} (recorded only)`);
    }
  }

  /** Update payout status from a transfer object id. */
  private async onTransferStatus(sanitized: SanitizedPayload, target: PayoutStatus): Promise<void> {
    if (!sanitized.objectId) {
      return;
    }
    const payment = await this.repo.findPaymentByTransferId(sanitized.objectId);
    if (payment) {
      await this.repo.setPayoutStatus(payment.id, target);
    }
  }

  private async onDisputeCreated(sanitized: SanitizedPayload): Promise<void> {
    const paymentId = await this.resolvePaymentIdFromCharge(sanitized);
    if (paymentId) {
      await this.disputes.openDispute(paymentId);
    }
  }

  private async onDisputeClosed(sanitized: SanitizedPayload): Promise<void> {
    const paymentId = await this.resolvePaymentIdFromCharge(sanitized);
    if (paymentId) {
      await this.disputes.closeDispute(paymentId, sanitized.status === 'won');
    }
  }

  /** account.updated: repair capabilities + release deferred payouts (idempotent). */
  private async onAccountUpdated(sanitized: SanitizedPayload): Promise<void> {
    if (!sanitized.objectId) {
      return;
    }
    const account = await this.repo.findAccountByStripeId(sanitized.objectId);
    if (account) {
      await this.connectReconciliation.reconcileAccount(sanitized.objectId, account.cleanerId);
    }
  }

  /** Resolve a payment id from a charge/dispute object via its charge id. */
  private async resolvePaymentIdFromCharge(sanitized: SanitizedPayload): Promise<string | null> {
    if (!sanitized.objectId) {
      return null;
    }
    const payment = await this.repo.findPaymentByChargeId(sanitized.objectId);
    return payment?.id ?? null;
  }
}
