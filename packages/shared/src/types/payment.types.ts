/**
 * Payment-related type definitions shared across the platform.
 */

export const PaymentStatus = {
  PENDING: 'pending',
  CAPTURED: 'captured',
  HELD_IN_ESCROW: 'held_in_escrow',
  RELEASED: 'released',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partially_refunded',
  DISPUTED: 'disputed',
} as const;

export type PaymentStatus = typeof PaymentStatus[keyof typeof PaymentStatus];

export const DisputeReason = {
  INCOMPLETE_CHECKLIST: 'incomplete_checklist',
  UNSATISFACTORY_QUALITY: 'unsatisfactory_quality',
  NO_SHOW: 'no_show',
  PROPERTY_DAMAGE: 'property_damage',
  OTHER: 'other',
} as const;

export type DisputeReason = typeof DisputeReason[keyof typeof DisputeReason];

export interface PaymentBreakdown {
  readonly servicePrice: number;
  readonly hostFeePercent: number;
  readonly hostFeeAmount: number;
  readonly cleanerFeePercent: number;
  readonly cleanerFeeAmount: number;
  readonly totalCharged: number;
  readonly cleanerPayout: number;
  readonly platformRevenue: number;
  readonly currency: string;
  // Optional so existing consumers created before Stripe escrow keep working:
  // these are only known once a charge settles through Stripe.
  /** Stripe processing fee in integer minor units (cents); absorbed by the platform. */
  readonly stripeFeeAmount?: number;
  /** Platform gross revenue minus the Stripe fee and any refund/reversal adjustments, in integer minor units (cents). */
  readonly netPlatformRevenue?: number;
}
