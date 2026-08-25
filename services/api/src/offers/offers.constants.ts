import { OfferState } from './offers.types';

/**
 * Offer module constants.
 *
 * All configurable values derived from environment variables with sensible defaults.
 * Business rule values (rates, timeouts, distances) are NEVER hardcoded in logic.
 */

/** Host service fee rate in basis points (default: 1000 = 10%) */
export const OFFER_HOST_FEE_RATE_BPS = parseInt(
  process.env.OFFER_HOST_FEE_RATE ?? '1000',
  10,
);

/** Cleaner commission rate in basis points (default: 300 = 3%) */
export const OFFER_CLEANER_RATE_BPS = parseInt(
  process.env.OFFER_CLEANER_RATE ?? '300',
  10,
);

/** Initial search radius in meters (default: 3000 = 3km) */
export const OFFER_INITIAL_RADIUS_M = parseInt(
  process.env.OFFER_INITIAL_RADIUS ?? '3000',
  10,
);

/** Radius expansion step size in meters (default: 2000 = 2km) */
export const OFFER_EXPANSION_STEP_M = parseInt(
  process.env.OFFER_EXPANSION_STEP ?? '2000',
  10,
);

/** Maximum search radius in meters (default: 25000 = 25km) */
export const OFFER_MAX_RADIUS_M = parseInt(
  process.env.OFFER_MAX_RADIUS ?? '25000',
  10,
);

/** Interval between radius expansions in milliseconds (default: 300000 = 5min) */
export const OFFER_EXPANSION_INTERVAL_MS = parseInt(
  process.env.OFFER_EXPANSION_INTERVAL_MS ?? '300000',
  10,
);

/** Final wait time after max radius before expiration in ms (default: 600000 = 10min) */
export const OFFER_FINAL_WAIT_MS = parseInt(
  process.env.OFFER_FINAL_WAIT_MS ?? '600000',
  10,
);

/** Time window for favorites-first delivery in ms (default: 180000 = 3min) */
export const OFFER_FAVORITES_WINDOW_MS = parseInt(
  process.env.OFFER_FAVORITES_WINDOW_MS ?? '180000',
  10,
);

/** Delay between PRO and FREE tier delivery in ms (default: 120000 = 2min) */
export const OFFER_PRO_FREE_DELAY_MS = parseInt(
  process.env.OFFER_PRO_FREE_DELAY_MS ?? '120000',
  10,
);

/** Minimum lead time before scheduled date in minutes (default: 60) */
export const OFFER_MIN_LEAD_MINUTES = parseInt(
  process.env.OFFER_MIN_LEAD_MINUTES ?? '60',
  10,
);

/** Minimum offer duration in minutes (default: 30) */
export const OFFER_MIN_DURATION_MINUTES = parseInt(
  process.env.OFFER_MIN_DURATION_MINUTES ?? '30',
  10,
);

/** Maximum offer duration in minutes (default: 480 = 8h) */
export const OFFER_MAX_DURATION_MINUTES = parseInt(
  process.env.OFFER_MAX_DURATION_MINUTES ?? '480',
  10,
);

/** Maximum job retries (default: 3) */
export const OFFER_MAX_RETRIES = parseInt(
  process.env.OFFER_MAX_RETRIES ?? '3',
  10,
);

/** Backoff delay for job retries in ms (default: 5000) */
export const OFFER_BACKOFF_DELAY_MS = parseInt(
  process.env.OFFER_BACKOFF_DELAY_MS ?? '5000',
  10,
);

/** Default page size for offer listings */
export const OFFER_LIST_DEFAULT_PAGE_SIZE = 20;

/** Maximum page size for offer listings */
export const OFFER_LIST_MAX_PAGE_SIZE = 100;

/**
 * Allowed state transitions map.
 * Key: current state, Value: array of valid target states.
 */
export const ALLOWED_TRANSITIONS: Record<OfferState, OfferState[]> = {
  [OfferState.DRAFT]: [OfferState.PUBLISHED, OfferState.CANCELLED],
  [OfferState.PUBLISHED]: [OfferState.ACTIVE, OfferState.CANCELLED, OfferState.EXPIRED],
  [OfferState.ACTIVE]: [OfferState.MATCHED, OfferState.CANCELLED, OfferState.EXPIRED],
  [OfferState.MATCHED]: [OfferState.COMPLETED],
  [OfferState.COMPLETED]: [],
  [OfferState.CANCELLED]: [],
  [OfferState.EXPIRED]: [],
};

/** Terminal states (no further transitions allowed) */
export const TERMINAL_STATES: OfferState[] = [
  OfferState.COMPLETED,
  OfferState.CANCELLED,
  OfferState.EXPIRED,
];

/** BullMQ queue names */
export const QUEUE_NAMES = {
  RADIUS_EXPANSION: 'offer-radius-expansion',
  TIER_DELIVERY: 'offer-tier-delivery',
  FAVORITES_WINDOW: 'offer-favorites-window',
  PUSH_NOTIFICATION: 'offer-push-notification',
} as const;

/**
 * Aggregated offer configuration object.
 * Provides a single import point for all offer config values.
 * Mirrors the OFFER_CONFIG structure from the design doc.
 */
export const OFFER_CONFIG = {
  HOST_SERVICE_FEE_RATE: OFFER_HOST_FEE_RATE_BPS,
  CLEANER_COMMISSION_RATE: OFFER_CLEANER_RATE_BPS,
  INITIAL_RADIUS_METERS: OFFER_INITIAL_RADIUS_M,
  EXPANSION_STEP_METERS: OFFER_EXPANSION_STEP_M,
  MAX_RADIUS_METERS: OFFER_MAX_RADIUS_M,
  EXPANSION_INTERVAL_MS: OFFER_EXPANSION_INTERVAL_MS,
  FINAL_WAIT_INTERVAL_MS: OFFER_FINAL_WAIT_MS,
  FAVORITES_WINDOW_MS: OFFER_FAVORITES_WINDOW_MS,
  PRO_TO_FREE_DELAY_MS: OFFER_PRO_FREE_DELAY_MS,
  MIN_LEAD_TIME_MINUTES: OFFER_MIN_LEAD_MINUTES,
  MIN_DURATION_MINUTES: OFFER_MIN_DURATION_MINUTES,
  MAX_DURATION_MINUTES: OFFER_MAX_DURATION_MINUTES,
  MAX_JOB_RETRIES: OFFER_MAX_RETRIES,
  BACKOFF_TYPE: 'exponential' as const,
  BACKOFF_DELAY_MS: OFFER_BACKOFF_DELAY_MS,
} as const;
