import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { NotificationsRepository } from './notifications.repository';
import { DeviceRegistryService } from './device-registry.service';
import { NotificationContentCatalog } from './notification-content.catalog';
import { OneSignalClient } from './onesignal/onesignal.client';
import { NotificationType } from './notifications.types';
import {
  NOTIFICATIONS_DELIVERY_MAX_ATTEMPTS,
  NOTIFICATIONS_QUEUE_NAMES,
} from './notifications.constants';
import { Notification } from './entities/notification.entity';

/** Job payload for a delivery attempt. */
export interface DeliveryJobData {
  readonly ledgerId: string;
}

/**
 * `DeliveryWorker` — BullMQ worker that delivers a PENDING ledger row.
 *
 * Flow: single-winner `PENDING -> PROCESSING` (losers no-op), resolve the recipient's consented
 * player ids (Model B); none -> `SUPPRESSED(no-device)`, no OneSignal call. Otherwise render `en`/`es`
 * content and send per player id with a provider idempotency key -> `SENT`. A transport failure ->
 * `FAILED_RETRYABLE` (rethrow so BullMQ retries with configured backoff) until attempts are
 * exhausted -> `FAILED_FINAL`. An invalid player id is marked stale (not repeatedly retried). Never
 * throws into a business flow — only into BullMQ's retry machinery.
 */
@Processor(NOTIFICATIONS_QUEUE_NAMES.DELIVERY)
export class DeliveryWorker extends WorkerHost {
  private readonly logger = new Logger(DeliveryWorker.name);

  constructor(
    private readonly repo: NotificationsRepository,
    private readonly registry: DeviceRegistryService,
    private readonly catalog: NotificationContentCatalog,
    private readonly oneSignal: OneSignalClient,
  ) {
    super();
  }

  async process(job: Job<DeliveryJobData>): Promise<void> {
    const { ledgerId } = job.data;

    // Single-winner: only the worker that flips PENDING -> PROCESSING proceeds.
    const won = await this.repo.claimForDelivery(ledgerId);
    if (!won) {
      return; // Another worker owns this row (or it is no longer PENDING) — no-op.
    }

    const ledger = await this.repo.findLedger(ledgerId);
    if (!ledger) {
      return;
    }

    const playerIds = await this.registry.resolveConsentedPlayerIds(ledger.recipientUserId);
    if (playerIds.length === 0) {
      await this.repo.markStatus(ledgerId, 'SUPPRESSED', 'no-device');
      return;
    }

    await this.deliver(job, ledger, playerIds);
  }

  /** Render content, send per consented player id, and record the outcome. */
  private async deliver(
    job: Job<DeliveryJobData>,
    ledger: Notification,
    playerIds: readonly string[],
  ): Promise<void> {
    const rendered = this.catalog.render(
      ledger.type as NotificationType,
      (ledger.payloadRef as Record<string, string> | null) ?? {},
    );

    const result = await this.oneSignal.send({
      playerIds,
      headings: rendered.headings,
      contents: rendered.contents,
      data: ledger.deepLink as Record<string, string>,
      idempotencyKey: ledger.dedupKey,
    });

    // Exclude any player id OneSignal reported invalid from future targeting.
    for (const invalid of result.invalidPlayerIds) {
      await this.registry.markStale(invalid);
    }

    if (result.ok) {
      await this.repo.markSent(ledger.id);
      return;
    }

    await this.handleFailure(job, ledger.id);
  }

  /**
   * On a transport failure: if attempts remain, mark FAILED_RETRYABLE and rethrow so BullMQ retries;
   * once exhausted, mark FAILED_FINAL and swallow (never throws into a business flow).
   */
  private async handleFailure(job: Job<DeliveryJobData>, ledgerId: string): Promise<void> {
    const attemptsMade = job.attemptsMade + 1;
    if (attemptsMade < NOTIFICATIONS_DELIVERY_MAX_ATTEMPTS) {
      await this.repo.markStatus(ledgerId, 'FAILED_RETRYABLE');
      throw new Error(`OneSignal delivery failed for ${ledgerId}; scheduling retry`);
    }
    await this.repo.markStatus(ledgerId, 'FAILED_FINAL');
    this.logger.warn(`Delivery exhausted retries for notification ${ledgerId}; marked FAILED_FINAL`);
  }
}
