import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { SubscriptionsRepository } from '../subscriptions.repository';
import { mapEventToDeltas } from '../revenuecat/revenuecat-event.mapper';
import { SanitizedEventPayload } from '../revenuecat/revenuecat-payload.sanitizer';
import { SUBSCRIPTION_QUEUE_NAME } from '../subscriptions.constants';

/** Job payload enqueued by the webhook controller / dispatch recovery worker. */
interface WebhookJobData {
  readonly ledgerId: string;
  readonly revenuecatEventId: string;
}

/**
 * RevenueCat webhook processor (BullMQ).
 *
 * Loads the RECEIVED/QUEUED ledger row, maps its sanitized payload to per-entitlement deltas,
 * and applies them to the mirror in ONE transaction (per-entitlement ordering guard + atomic
 * TRANSFER), marking the ledger PROCESSED in the same transaction. Idempotent: reprocessing an
 * already-PROCESSED event, or a stale event, is a safe no-op. On retry exhaustion the job is
 * marked FAILED (dead-letter) so no event is silently lost.
 */
@Processor(SUBSCRIPTION_QUEUE_NAME)
export class RevenueCatWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(RevenueCatWebhookProcessor.name);

  constructor(private readonly repo: SubscriptionsRepository) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    const { ledgerId, revenuecatEventId } = job.data;

    const ledgerRow = await this.repo.findLedgerRow(ledgerId);
    if (!ledgerRow) {
      this.logger.warn(`Ledger row ${ledgerId} (event ${revenuecatEventId}) not found; skipping`);
      return;
    }
    if (ledgerRow.dispatchStatus === 'PROCESSED') {
      return; // idempotent: already applied
    }

    const payload = ledgerRow.payloadJson as unknown as SanitizedEventPayload;
    const deltas = mapEventToDeltas(payload);

    // applyDeltas marks the ledger PROCESSED in the same transaction (even when deltas is empty,
    // e.g. an unknown/unhandled event type — recorded, mirror untouched, reconciliation arbiter).
    await this.repo.applyDeltas(deltas, ledgerId);
  }

  /** BullMQ invokes this after retries are exhausted: mark FAILED so the event is not lost. */
  async onFailed(job: Job<WebhookJobData>): Promise<void> {
    const attemptsMade = job.attemptsMade ?? 0;
    const maxAttempts = job.opts.attempts ?? 1;
    if (attemptsMade >= maxAttempts) {
      await this.repo.markFailed(job.data.ledgerId);
      this.logger.error(
        `Webhook processing exhausted retries for event ${job.data.revenuecatEventId}; marked FAILED`,
      );
    }
  }
}
