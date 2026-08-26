/**
 * Offer Queues Module.
 *
 * Registers all 4 BullMQ queues used by the offers module with
 * configurable retry and exponential backoff settings.
 *
 * Queues:
 * - offer-radius-expansion: Progressive search radius expansion
 * - offer-tier-delivery: Tiered delivery to PRO/FREE Cleaners
 * - offer-favorites-window: Favorites window expiration trigger
 * - offer-push-notification: Push notification delivery via OneSignal
 *
 * All queues share the same default job options (retry count + exponential backoff)
 * sourced from environment-based constants (OFFER_MAX_RETRIES, OFFER_BACKOFF_DELAY_MS).
 */

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { OFFER_QUEUE_CONFIGS } from './offer-queue.constants';

@Module({
  imports: [
    ...OFFER_QUEUE_CONFIGS.map((config) =>
      BullModule.registerQueue({
        name: config.name,
        defaultJobOptions: config.defaultJobOptions,
      }),
    ),
  ],
  exports: [BullModule],
})
export class OfferQueuesModule {}
