import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Interval } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { SubscriptionsRepository } from '../subscriptions.repository';
import {
  SUBSCRIPTION_DISPATCH_GRACE_MS,
  SUBSCRIPTION_JOB_NAME,
  SUBSCRIPTION_QUEUE_NAME,
  SUBSCRIPTION_RECONCILE_BATCH,
} from '../subscriptions.constants';

/**
 * Subscription dispatch recovery worker.
 *
 * Closes the "acknowledged but never queued" gap (P16): periodically finds ledger rows still
 * RECEIVED/QUEUED past the grace period (enqueue failed, or the worker crashed before marking
 * PROCESSED) and re-enqueues them. Idempotent with the processor via the per-entitlement
 * ordering guard + PROCESSED short-circuit, so a re-enqueue never double-applies an event.
 */
@Injectable()
export class SubscriptionDispatchWorker {
  private readonly logger = new Logger(SubscriptionDispatchWorker.name);

  constructor(
    private readonly repo: SubscriptionsRepository,
    @InjectQueue(SUBSCRIPTION_QUEUE_NAME)
    private readonly webhookQueue: Queue,
  ) {}

  /** Grace period before a RECEIVED/QUEUED row is considered orphaned. */
  static getGraceMs(): number {
    return SUBSCRIPTION_DISPATCH_GRACE_MS;
  }

  /** Re-enqueue orphaned ledger rows. Errors per row are logged, not thrown. */
  @Interval(SubscriptionDispatchWorker.getGraceMs())
  async sweep(): Promise<void> {
    try {
      const orphans = await this.repo.findRecovered(
        SUBSCRIPTION_DISPATCH_GRACE_MS,
        SUBSCRIPTION_RECONCILE_BATCH,
      );
      for (const row of orphans) {
        await this.reenqueue(row.id, row.revenuecatEventId);
      }
      if (orphans.length > 0) {
        this.logger.debug(`Dispatch recovery re-enqueued ${orphans.length} ledger row(s)`);
      }
    } catch (error) {
      this.logger.error(`Dispatch recovery sweep failed: ${String(error)}`);
    }
  }

  private async reenqueue(ledgerId: string, revenuecatEventId: string): Promise<void> {
    try {
      await this.webhookQueue.add(SUBSCRIPTION_JOB_NAME, { ledgerId, revenuecatEventId });
      await this.repo.markQueued(ledgerId);
    } catch (error) {
      this.logger.warn(
        `Dispatch recovery failed to re-enqueue ${revenuecatEventId}; will retry next sweep`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
