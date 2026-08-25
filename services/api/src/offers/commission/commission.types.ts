/**
 * Commission-specific types.
 *
 * Supplements the main offers.types.ts with commission calculation internals.
 */

/** Input parameters for commission calculation */
export interface CommissionCalculationInput {
  /** Offered price in cents (must be positive integer) */
  readonly priceCents: number;
  /** Fee rate in basis points (optional — defaults to env config) */
  readonly rateBps?: number;
}

/** Result of a single fee/commission calculation */
export interface CommissionCalculationResult {
  /** Calculated fee/commission amount in cents */
  readonly amountCents: number;
  /** Rate used for calculation in basis points */
  readonly rateBps: number;
}
