import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { QUEUE_NAMES } from '../offers.constants';
import { FavoritesWindowJobData } from '../queues/offer-queue.types';

/**
 * BullMQ worker for favorites window expiration.
 *
 * Processes delayed jobs from the offer-favorites-window queue.
 * When the favorites-first delivery window expires, this processor
 * triggers PRO tier delivery if the offer is still in a deliverable state.
 *
 * Stale job guard: validates offer state before processing.
 * If the offer has already been matched, cancelled, or expired,
 * the job completes silently (idempotent).
 */
@Processor(QUEUE_NAMES.FAVORITES_WINDOW)
export class FavoritesWindowProcessor extends WorkerHost {
  private readonly logger = new Logger(FavoritesWindowProcessor.name);

  /**
   * Process a favorites window expiration job.
   *
   * Validates state via stale-job guard, then triggers PRO delivery.
   *
   * @param job - BullMQ job with FavoritesWindowJobData payload
   */
  async process(job: Job<FavoritesWindowJobData>): Promise<void> {
    const { offerId, expectedState } = job.data;

    this.logger.log(
      `Processing favorites window expiration: offer=${offerId}, expectedState=${expectedState}`,
    );

    // TODO(BID-OFFER): Implement stale-job guard + PRO delivery trigger
  }
}
