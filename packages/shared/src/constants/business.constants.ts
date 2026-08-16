/**
 * Business configuration constants.
 * These define the core business rules of BidClean.
 * Override via environment variables in production.
 */

/** Commission charged to the Host (percentage of service price) */
export const HOST_COMMISSION_PERCENT = 0.10;

/** Commission charged to the Cleaner (percentage of service price) */
export const CLEANER_COMMISSION_PERCENT = 0.03;

/** Total platform commission */
export const TOTAL_COMMISSION_PERCENT = HOST_COMMISSION_PERCENT + CLEANER_COMMISSION_PERCENT;

/** Initial search radius in kilometers for offer alerts */
export const INITIAL_SEARCH_RADIUS_KM = 2;

/** Maximum search radius in kilometers */
export const MAX_SEARCH_RADIUS_KM = 30;

/** Radius expansion increment in kilometers */
export const RADIUS_EXPANSION_STEP_KM = 2;

/** Time between radius expansions in milliseconds (1 minute) */
export const RADIUS_EXPANSION_INTERVAL_MS = 60_000;

/** Time advantage for PRO cleaners before free cleaners see the offer (ms) */
export const PRO_ADVANTAGE_DELAY_MS = 30_000;

/** Time the Cleaner has to decide on an offer (ms) — 1 minute */
export const OFFER_DECISION_TIMEOUT_MS = 60_000;

/** Geofence radius for arrival detection (meters) */
export const ARRIVAL_GEOFENCE_RADIUS_M = 50;

/** Number of free cancellations before penalty applies */
export const FREE_CANCELLATION_LIMIT = 2;

/** Minimum offer price in USD (equivalent) */
export const MIN_OFFER_PRICE_USD = 10;
