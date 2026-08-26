import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { QUEUE_NAMES } from '../offers.constants';
import { TierDeliveryJobData } from '../queues/offer-queue.types';

/**
 * BullMQ worker for tier-based offer delivery.
 *
 * Processes delayed jobs from the offer-tier-delivery queue.
 * Each job delivers an offer to PRO or FREE tier Cleaners after
 * the configured delay (favorites window or PRO→FREE delay).
 *
 * Stale job guard: validates offer state + expansion step before processing.
 * If validation fails, the job completes silently (idempotent).
 */
@Processor(QUEUE_NAMES.TIER_DELIVERY)
export class TierDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(TierDeliveryProcessor.name);

  /**
   * Process a tier delivery job.
   *
   * Validates state via stale-job guard, then delivers offer
   * to all Cleaners in the specified tier.
   *
   * @param job - BullMQ job with TierDeliveryJobData payload
   */
  async process(job: Job<TierDeliveryJobData>): Promise<void> {
    const { offerId, tier, radiusStep } = job.data;

    this.logger.log(
      `Processing tier delivery: offer=${offerId}, tier=${tier}, step=${radiusStep}`,
    );

    // TODO(BID-OFFER): Implement stale-job guard + tier delivery logic
  }
}
