import { Injectable } from '@nestjs/common';
import { CommissionBreakdown } from '../offers.types';
import {
  OFFER_HOST_FEE_RATE_BPS,
  OFFER_CLEANER_RATE_BPS,
} from '../offers.constants';
import {
  CommissionCalculationInput,
  CommissionCalculationResult,
} from './commission.types';

/** Basis points divisor: 10000 bps = 100% */
const BPS_DIVISOR = 10000;

/**
 * Commission calculation service.
 *
 * Handles all monetary calculations with integer-only arithmetic.
 * - Host fee: added ON TOP of the offered price (default 10%)
 * - Cleaner commission: deducted FROM the offered price (default 3%)
 * - All values stored as cents (integers)
 * - Rates stored as basis points (1 bp = 0.01%)
 * - Uses Math.trunc for integer division — no floating-point rounding
 */
@Injectable()
export class CommissionService {
  /**
   * Calculate Host service fee in cents.
   *
   * Formula: fee = Math.trunc(priceCents * rateBps / 10000)
   *
   * @param input - Price in cents and optional custom rate in basis points
   * @returns Calculation result with fee amount and rate used
   * @throws Error if priceCents is not a positive integer
   */
  calculateHostFee(input: CommissionCalculationInput): CommissionCalculationResult {
    const { priceCents, rateBps } = this.validateAndExtract(input, OFFER_HOST_FEE_RATE_BPS);
    const amountCents = Math.trunc((priceCents * rateBps) / BPS_DIVISOR);

    return { amountCents, rateBps };
  }

  /**
   * Calculate Cleaner commission in cents.
   *
   * Formula: commission = Math.trunc(priceCents * rateBps / 10000)
   *
   * @param input - Price in cents and optional custom rate in basis points
   * @returns Calculation result with commission amount and rate used
   * @throws Error if priceCents is not a positive integer
   */
  calculateCleanerCommission(input: CommissionCalculationInput): CommissionCalculationResult {
    const { priceCents, rateBps } = this.validateAndExtract(input, OFFER_CLEANER_RATE_BPS);
    const amountCents = Math.trunc((priceCents * rateBps) / BPS_DIVISOR);

    return { amountCents, rateBps };
  }

  /**
   * Get full price breakdown for an offer.
   *
   * Returns all calculated values for both Host and Cleaner views.
   * Uses the configured default rates unless custom rates are provided.
   *
   * @param priceCents - Offered price in cents (must be positive integer)
   * @param hostRateBps - Optional custom host fee rate in basis points
   * @param cleanerRateBps - Optional custom cleaner commission rate in basis points
   * @returns Complete commission breakdown with all calculated values
   * @throws Error if priceCents is not a positive integer
   */
  getFullBreakdown(
    priceCents: number,
    hostRateBps?: number,
    cleanerRateBps?: number,
  ): CommissionBreakdown {
    const hostFee = this.calculateHostFee({ priceCents, rateBps: hostRateBps });
    const cleanerCommission = this.calculateCleanerCommission({ priceCents, rateBps: cleanerRateBps });

    return {
      offeredPriceCents: priceCents,
      hostFeeCents: hostFee.amountCents,
      hostTotalCents: priceCents + hostFee.amountCents,
      cleanerCommissionCents: cleanerCommission.amountCents,
      cleanerPayoutCents: priceCents - cleanerCommission.amountCents,
      hostFeeRateBps: hostFee.rateBps,
      cleanerRateBps: cleanerCommission.rateBps,
    };
  }

  /**
   * Validates input and extracts price and rate values.
   *
   * @param input - Commission calculation input
   * @param defaultRateBps - Default rate to use if not provided in input
   * @returns Validated price and rate
   * @throws Error if priceCents is not a positive integer
   */
  private validateAndExtract(
    input: CommissionCalculationInput,
    defaultRateBps: number,
  ): { priceCents: number; rateBps: number } {
    const { priceCents, rateBps } = input;

    if (!Number.isInteger(priceCents) || priceCents <= 0) {
      throw new Error(
        `priceCents must be a positive integer, received: ${priceCents}`,
      );
    }

    const effectiveRate = rateBps ?? defaultRateBps;

    if (!Number.isInteger(effectiveRate) || effectiveRate < 0) {
      throw new Error(
        `rateBps must be a non-negative integer, received: ${effectiveRate}`,
      );
    }

    return { priceCents, rateBps: effectiveRate };
  }
}
