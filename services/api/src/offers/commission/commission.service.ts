import { Injectable } from '@nestjs/common';
import { CommissionBreakdown } from '../offers.types';
import {
  OFFER_HOST_FEE_RATE_BPS,
  OFFER_CLEANER_RATE_BPS,
} from '../offers.constants';

/**
 * Commission calculation service.
 *
 * Handles all monetary calculations with integer-only arithmetic.
 * - Host fee: added ON TOP of the offered price (10% default)
 * - Cleaner commission: deducted FROM the offered price (3% default)
 * - All values stored as cents (integers)
 * - Rates stored as basis points (1 bp = 0.01%)
 * - Uses Math.trunc for integer division — no floating-point
 */
@Injectable()
export class CommissionService {
  /**
   * Calculate Host service fee in cents.
   * fee = trunc(priceCents * rateBps / 10000)
   */
  calculateHostFee(priceCents: number): number {
    // TODO: Implement in Task 9
    return Math.trunc((priceCents * OFFER_HOST_FEE_RATE_BPS) / 10000);
  }

  /**
   * Calculate Cleaner commission in cents.
   * commission = trunc(priceCents * rateBps / 10000)
   */
  calculateCleanerCommission(priceCents: number): number {
    // TODO: Implement in Task 9
    return Math.trunc((priceCents * OFFER_CLEANER_RATE_BPS) / 10000);
  }

  /**
   * Get full price breakdown for an offer.
   * Returns all calculated values for both Host and Cleaner views.
   */
  getFullBreakdown(offeredPriceCents: number): CommissionBreakdown {
    // TODO: Implement in Task 9
    const hostFeeCents = this.calculateHostFee(offeredPriceCents);
    const cleanerCommissionCents = this.calculateCleanerCommission(offeredPriceCents);

    return {
      offeredPriceCents,
      hostFeeCents,
      hostTotalCents: offeredPriceCents + hostFeeCents,
      cleanerCommissionCents,
      cleanerPayoutCents: offeredPriceCents - cleanerCommissionCents,
      hostFeeRateBps: OFFER_HOST_FEE_RATE_BPS,
      cleanerRateBps: OFFER_CLEANER_RATE_BPS,
    };
  }
}
