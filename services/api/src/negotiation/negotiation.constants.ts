/**
 * Negotiation module constants.
 *
 * All configurable business values derive from environment variables with sensible
 * defaults. Values are validated at startup (fail-fast) so a misconfiguration never
 * surfaces as a runtime error while a user is negotiating.
 */

/** Basis-points divisor (1 bp = 0.01%) */
export const BPS_DIVISOR = 10000;

/**
 * Maximum allowed downward deviation from the Base Price, in basis points.
 * Default: 2000 bps = 20% below the Host's offered price.
 */
export const NEGOTIATION_MIN_DEVIATION_BPS = parseInt(
  process.env.NEGOTIATION_MIN_DEVIATION_BPS ?? '2000',
  10,
);

/**
 * Maximum allowed upward deviation from the Base Price, in basis points.
 * Default: 2000 bps = 20% above the Host's offered price.
 */
export const NEGOTIATION_MAX_DEVIATION_BPS = parseInt(
  process.env.NEGOTIATION_MAX_DEVIATION_BPS ?? '2000',
  10,
);

/**
 * Response window for a PENDING proposal in milliseconds.
 * After this elapses without a response, the proposal is marked EXPIRED.
 * Default: 900000 ms = 15 minutes.
 */
export const NEGOTIATION_RESPONSE_WINDOW_MS = parseInt(
  process.env.NEGOTIATION_RESPONSE_WINDOW_MS ?? '900000',
  10,
);

/**
 * Maximum number of proposals allowed in a single thread (counts every proposal
 * ever created, including terminal ones). Default: 6.
 */
export const NEGOTIATION_MAX_PROPOSALS_PER_THREAD = parseInt(
  process.env.NEGOTIATION_MAX_PROPOSALS ?? '6',
  10,
);

/**
 * Interval for the proposal expiration sweep in milliseconds.
 * Default: 60000 ms = 60 seconds.
 */
export const NEGOTIATION_EXPIRY_SWEEP_INTERVAL_MS = parseInt(
  process.env.NEGOTIATION_EXPIRY_SWEEP_MS ?? '60000',
  10,
);

/**
 * Interval for the reconciliation sweep in milliseconds.
 * Default: 120000 ms = 2 minutes.
 */
export const NEGOTIATION_RECONCILE_INTERVAL_MS = parseInt(
  process.env.NEGOTIATION_RECONCILE_INTERVAL_MS ?? '120000',
  10,
);

/** Centrifugo channel builders for negotiation events */
export const NEGOTIATION_CHANNELS = {
  host: (hostId: string): string => `negotiation:host:${hostId}`,
  cleaner: (cleanerId: string): string => `negotiation:cleaner:${cleanerId}`,
  /** Existing radar channel — used to clear pins on other Cleaners when an offer is matched */
  offersCleaner: (cleanerId: string): string => `offers:cleaner:${cleanerId}`,
} as const;

/**
 * Validate negotiation configuration at startup. Throws a descriptive error if any
 * value is out of range so the application fails to boot rather than misbehaving later.
 *
 * @throws Error if any configuration value is invalid
 */
export function validateNegotiationConfig(): void {
  const errors: string[] = [];

  if (
    !Number.isInteger(NEGOTIATION_MIN_DEVIATION_BPS) ||
    NEGOTIATION_MIN_DEVIATION_BPS < 0 ||
    NEGOTIATION_MIN_DEVIATION_BPS > BPS_DIVISOR
  ) {
    errors.push(
      `NEGOTIATION_MIN_DEVIATION_BPS must be an integer in [0, ${BPS_DIVISOR}], got ${NEGOTIATION_MIN_DEVIATION_BPS}`,
    );
  }

  if (
    !Number.isInteger(NEGOTIATION_MAX_DEVIATION_BPS) ||
    NEGOTIATION_MAX_DEVIATION_BPS < 0 ||
    NEGOTIATION_MAX_DEVIATION_BPS > BPS_DIVISOR
  ) {
    errors.push(
      `NEGOTIATION_MAX_DEVIATION_BPS must be an integer in [0, ${BPS_DIVISOR}], got ${NEGOTIATION_MAX_DEVIATION_BPS}`,
    );
  }

  if (!Number.isInteger(NEGOTIATION_RESPONSE_WINDOW_MS) || NEGOTIATION_RESPONSE_WINDOW_MS <= 0) {
    errors.push(
      `NEGOTIATION_RESPONSE_WINDOW_MS must be a positive integer, got ${NEGOTIATION_RESPONSE_WINDOW_MS}`,
    );
  }

  if (
    !Number.isInteger(NEGOTIATION_MAX_PROPOSALS_PER_THREAD) ||
    NEGOTIATION_MAX_PROPOSALS_PER_THREAD <= 0
  ) {
    errors.push(
      `NEGOTIATION_MAX_PROPOSALS_PER_THREAD must be a positive integer, got ${NEGOTIATION_MAX_PROPOSALS_PER_THREAD}`,
    );
  }

  if (
    !Number.isInteger(NEGOTIATION_EXPIRY_SWEEP_INTERVAL_MS) ||
    NEGOTIATION_EXPIRY_SWEEP_INTERVAL_MS <= 0
  ) {
    errors.push(
      `NEGOTIATION_EXPIRY_SWEEP_INTERVAL_MS must be a positive integer, got ${NEGOTIATION_EXPIRY_SWEEP_INTERVAL_MS}`,
    );
  }

  if (
    !Number.isInteger(NEGOTIATION_RECONCILE_INTERVAL_MS) ||
    NEGOTIATION_RECONCILE_INTERVAL_MS <= 0
  ) {
    errors.push(
      `NEGOTIATION_RECONCILE_INTERVAL_MS must be a positive integer, got ${NEGOTIATION_RECONCILE_INTERVAL_MS}`,
    );
  }

  if (errors.length > 0) {
    throw new Error(`Invalid negotiation configuration:\n- ${errors.join('\n- ')}`);
  }
}
