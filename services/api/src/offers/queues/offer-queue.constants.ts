/**
 * Queue-specific configuration constants.
 *
 * Defines default job options and queue registration configs.
 * All values derived from OFFER_CONFIG (environment-based constants).
 */

import { OFFER_CONFIG, QUEUE_NAMES } from '../offers.constants';

/** Job names used when adding jobs to each queue */
export const JOB_NAMES = {
  EXPAND_RADIUS: 'expand-radius',
  DELIVER_TO_TIER: 'deliver-to-tier',
  FAVORITES_EXPIRED: 'favorites-expired',
  SEND_PUSH: 'send-push',
} as const;

/**
 * Default BullMQ job options applied to all offer queues.
 *
 * Configures retry behavior with exponential backoff.
 * Values sourced from OFFER_CONFIG (environment variables).
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: OFFER_CONFIG.MAX_JOB_RETRIES,
  backoff: {
    type: OFFER_CONFIG.BACKOFF_TYPE,
    delay: OFFER_CONFIG.BACKOFF_DELAY_MS,
  },
  removeOnComplete: true,
  removeOnFail: false,
} as const;

/**
 * BullMQ queue registration configurations for all offer queues.
 *
 * Each entry provides the queue name and default job options.
 * Used by OfferQueuesModule and OffersModule for BullModule.registerQueue().
 */
export const OFFER_QUEUE_CONFIGS = [
  { name: QUEUE_NAMES.RADIUS_EXPANSION, defaultJobOptions: DEFAULT_JOB_OPTIONS },
  { name: QUEUE_NAMES.TIER_DELIVERY, defaultJobOptions: DEFAULT_JOB_OPTIONS },
  { name: QUEUE_NAMES.FAVORITES_WINDOW, defaultJobOptions: DEFAULT_JOB_OPTIONS },
  { name: QUEUE_NAMES.PUSH_NOTIFICATION, defaultJobOptions: DEFAULT_JOB_OPTIONS },
] as const;
