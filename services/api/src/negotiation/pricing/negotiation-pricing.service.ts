import { Injectable } from '@nestjs/common';
import { CommissionService } from '../../offers/commission/commission.service';
import { Offer } from '../../offers/entities/offer.entity';
import { CommissionBreakdown } from '../../offers/offers.types';
import {
  BPS_DIVISOR,
  NEGOTIATION_MIN_DEVIATION_BPS,
  NEGOTIATION_MAX_DEVIATION_BPS,
} from '../negotiation.constants';

/** Inclusive allowed price range for a proposal, in integer cents */
export interface DeviationRange {
  readonly minPriceCents: number;
  readonly maxPriceCents: number;
}

/**
 * Negotiation pricing service.
 *
 * Thin wrapper over the offer-publishing CommissionService so that every
 * proposal reuses the offer's snapshotted commission rates and integer-only
 * rounding. This module NEVER implements an independent commission or rounding
 * algorithm (Requirement 6.2).
 *
 * It also computes and enforces the deviation bounds, always evaluated against
 * the immutable Base Price (never a prior proposal) — Correctness Property P11.
 */
@Injectable()
export class NegotiationPricingService {
  constructor(private readonly commission: CommissionService) {}

  /**
   * Compute the full payout/host-total breakdown for a proposed price using the
   * offer's snapshotted rate bps.
   *
   * @param offer - The offer being negotiated (source of snapshotted rates)
   * @param proposedPriceCents - The proposed price in cents
   * @returns The commission breakdown for the proposed price
   */
  computeBreakdown(offer: Offer, proposedPriceCents: number): CommissionBreakdown {
    return this.commission.getFullBreakdown(
      proposedPriceCents,
      offer.hostServiceFeeRateBps,
      offer.cleanerCommissionRateBps,
    );
  }

  /**
   * Compute the inclusive allowed price range relative to the immutable Base Price.
   * Uses integer-only Math.trunc bps arithmetic.
   *
   * @param basePriceCents - The offer's original offered price (the Base Price)
   * @returns The inclusive [min, max] allowed proposal price range
   */
  getDeviationRange(basePriceCents: number): DeviationRange {
    const minDelta = Math.trunc((basePriceCents * NEGOTIATION_MIN_DEVIATION_BPS) / BPS_DIVISOR);
    const maxDelta = Math.trunc((basePriceCents * NEGOTIATION_MAX_DEVIATION_BPS) / BPS_DIVISOR);

    return {
      minPriceCents: basePriceCents - minDelta,
      maxPriceCents: basePriceCents + maxDelta,
    };
  }

  /**
   * Whether a proposed price is within the allowed deviation bounds of the Base Price.
   *
   * @param basePriceCents - The immutable Base Price
   * @param proposedPriceCents - The proposed price to validate
   * @returns true if within the inclusive allowed range
   */
  isWithinDeviationBounds(basePriceCents: number, proposedPriceCents: number): boolean {
    const { minPriceCents, maxPriceCents } = this.getDeviationRange(basePriceCents);
    return proposedPriceCents >= minPriceCents && proposedPriceCents <= maxPriceCents;
  }
}
