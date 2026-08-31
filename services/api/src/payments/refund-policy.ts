import { DisputeStatus, PaymentStatus, PayoutStatus, RefundDecision } from './payments.types';

/**
 * Pure refund/reversal policy.
 *
 * Given the current payment/payout/dispute state and a requested amount, decides
 * how much to Refund to the Host and how much to reverse from the Cleaner's Transfer,
 * per the Post-Release Refund & Transfer Reversal Policy:
 *
 * - Pre-release (HELD / PARTIALLY_REFUNDED, payout not TRANSFER_CREATED/PAID):
 *   Stripe Refund only; no reversal (funds fully on the platform balance).
 * - Post-release (payout TRANSFER_CREATED / PAID): Stripe Refund PLUS a proportional
 *   Transfer Reversal to recover the Cleaner's share.
 * - Dispute OPEN: blocked (the dispute workflow decides).
 * - Refund ceiling = host_total_cents; reversal ceiling = cleaner_payout_cents.
 * - The Stripe processing fee is absorbed by the platform, never charged to the Cleaner.
 *
 * All arithmetic is integer (cents). This module is pure and side-effect free.
 */

/** Inputs required to decide a refund */
export interface RefundPolicyInput {
  readonly paymentStatus: PaymentStatus;
  readonly payoutStatus: PayoutStatus;
  readonly disputeStatus: DisputeStatus;
  /** Requested refund amount in cents; when undefined, the full remaining amount is used */
  readonly requestedAmountCents?: number;
  readonly hostTotalCents: number;
  readonly cleanerPayoutCents: number;
  readonly alreadyRefundedCents: number;
  readonly alreadyReversedCents: number;
}

/** Payout states in which the Cleaner's funds have already moved off the platform balance */
const POST_RELEASE_PAYOUT_STATES: PayoutStatus[] = [
  PayoutStatus.TRANSFER_CREATED,
  PayoutStatus.PAID,
];

/** Payment states from which a refund is even conceptually possible */
const REFUNDABLE_PAYMENT_STATES: PaymentStatus[] = [
  PaymentStatus.HELD,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.RELEASED,
];

/**
 * Decide the refund and reversal amounts (or block the refund).
 *
 * @param input - Current state + requested amount
 * @returns The refund decision (integer cents)
 */
export function decideRefund(input: RefundPolicyInput): RefundDecision {
  const blocked = (reason: string): RefundDecision => ({
    refundAmountCents: 0,
    reversalAmountCents: 0,
    blocked: true,
    reason,
  });

  if (input.disputeStatus === DisputeStatus.OPEN) {
    return blocked('Refund blocked while a dispute is open');
  }

  if (!REFUNDABLE_PAYMENT_STATES.includes(input.paymentStatus)) {
    return blocked(`Payment in status ${input.paymentStatus} cannot be refunded`);
  }

  const refundRemaining = input.hostTotalCents - input.alreadyRefundedCents;
  if (refundRemaining <= 0) {
    return blocked('Payment has already been fully refunded');
  }

  const requested = input.requestedAmountCents ?? refundRemaining;
  if (!Number.isInteger(requested) || requested <= 0) {
    return blocked('Refund amount must be a positive integer');
  }
  if (requested > refundRemaining) {
    return blocked(
      `Refund amount ${requested} exceeds the remaining refundable ${refundRemaining}`,
    );
  }

  const isPostRelease = POST_RELEASE_PAYOUT_STATES.includes(input.payoutStatus);
  if (!isPostRelease) {
    // Pre-release: refund only, no reversal.
    return { refundAmountCents: requested, reversalAmountCents: 0, blocked: false };
  }

  // Post-release: reverse the Cleaner's proportional share of this refund.
  const reversalAmount = computeProportionalReversal(
    requested,
    input.hostTotalCents,
    input.cleanerPayoutCents,
  );

  const reversalRemaining = input.cleanerPayoutCents - input.alreadyReversedCents;
  if (reversalAmount > reversalRemaining) {
    return blocked(
      `Reversal amount ${reversalAmount} exceeds the remaining reversible ${reversalRemaining}`,
    );
  }

  return { refundAmountCents: requested, reversalAmountCents: reversalAmount, blocked: false };
}

/**
 * Compute the Cleaner's proportional share of a refund to reverse from their Transfer.
 *
 * reversal = trunc(refund * cleaner_payout / host_total), clamped to [0, cleaner_payout].
 * Integer-only; the platform commission portion of the refund comes from the platform
 * balance, and the Stripe fee is absorbed by the platform.
 */
export function computeProportionalReversal(
  refundAmountCents: number,
  hostTotalCents: number,
  cleanerPayoutCents: number,
): number {
  if (hostTotalCents <= 0) {
    return 0;
  }
  const raw = Math.trunc((refundAmountCents * cleanerPayoutCents) / hostTotalCents);
  return Math.max(0, Math.min(raw, cleanerPayoutCents));
}
