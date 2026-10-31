import { DisputeResolution, FinancialIntentAction } from '../dispute.types';

/**
 * resolution-mapping (pure) — maps a resolution + phase + requested amount to the financial ACTION
 * dispute-system durably enqueues (Spec 21, P10). It chooses the action + REQUESTED amount only;
 * Spec 9 computes the exact amounts, ceilings, and proportional reversal at drain time.
 *
 * | resolution     | action           | notes                                                    |
 * | -------------- | ---------------- | -------------------------------------------------------- |
 * | FAVOR_CLEANER  | RELEASE          | release held funds (POST_RELEASE → Spec 9 accepted NO_OP)|
 * | FAVOR_HOST     | FULL_REFUND      | refund (POST_RELEASE → Spec 9 adds proportional reversal)|
 * | PARTIAL        | PARTIAL_REFUND   | Spec 9 ceilings the requested amount                     |
 *
 * Pure, no I/O.
 */

/** The financial action + requested amount a resolution maps to. */
export interface MappedFinancialAction {
  readonly action: FinancialIntentAction;
  /** Requested amount in cents for `PARTIAL_REFUND`; null for release/full refund. */
  readonly amountCents: number | null;
}

/**
 * Map a resolution to its durable financial action. `requestedRefundCents` is used only for
 * `PARTIAL`. Throws if `PARTIAL` is requested without a non-negative integer amount (caller-validated
 * upstream, but this keeps the mapping total and safe).
 */
export function mapResolutionToAction(
  resolution: DisputeResolution,
  requestedRefundCents: number | null,
): MappedFinancialAction {
  switch (resolution) {
    case DisputeResolution.FAVOR_CLEANER:
      return { action: FinancialIntentAction.RELEASE, amountCents: null };
    case DisputeResolution.FAVOR_HOST:
      return { action: FinancialIntentAction.FULL_REFUND, amountCents: null };
    case DisputeResolution.PARTIAL:
      if (
        requestedRefundCents === null ||
        !Number.isInteger(requestedRefundCents) ||
        requestedRefundCents < 0
      ) {
        throw new Error('PARTIAL resolution requires a non-negative integer refund amount');
      }
      return { action: FinancialIntentAction.PARTIAL_REFUND, amountCents: requestedRefundCents };
    default: {
      const exhaustive: never = resolution;
      throw new Error(`Unknown resolution: ${String(exhaustive)}`);
    }
  }
}
