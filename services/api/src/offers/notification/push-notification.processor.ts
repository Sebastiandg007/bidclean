import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { QUEUE_NAMES } from '../offers.constants';
import { PushNotificationJobData } from '../queues/offer-queue.types';

/**
 * BullMQ worker for push notification delivery.
 *
 * Processes immediate jobs from the offer-push-notification queue.
 * Each job sends a push notification to a single Cleaner via OneSignal.
 *
 * This queue handles notifications that failed WebSocket delivery
 * and need push fallback, or scheduled bulk push notifications.
 *
 * Jobs are immediate (no delay) with retry + exponential backoff
 * configured via default job options.
 */
@Processor(QUEUE_NAMES.PUSH_NOTIFICATION)
export class PushNotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(PushNotificationProcessor.name);

  /**
   * Process a push notification job.
   *
   * Sends push notification via OneSignal to the target Cleaner.
   *
   * @param job - BullMQ job with PushNotificationJobData payload
   */
  async process(job: Job<PushNotificationJobData>): Promise<void> {
    const { offerId, cleanerId, tier } = job.data;

    this.logger.log(
      `Processing push notification: offer=${offerId}, cleaner=${cleanerId}, tier=${tier}`,
    );

    // TODO(BID-OFFER): Implement push notification delivery via OfferNotificationService
  }
}
