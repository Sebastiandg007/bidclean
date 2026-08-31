import { CommissionRuleRow } from './commission.types';

/**
 * Pure specificity + deterministic ordering for commission-rule resolution.
 *
 * A rule's specificity score is the count of its exactly-matched (non-ANY) scope
 * dimensions. The deterministic winner ordering is: specificity DESC, priority DESC,
 * effective_from DESC, then lowest UUID ASC as the final always-deterministic tie-break.
 * No I/O, no money arithmetic.
 */

/** Count of non-ANY (non-null) scope dimensions on a rule. */
export function specificityScore(rule: {
  country: string | null;
  subscriberTier: string | null;
  serviceType: string | null;
}): number {
  return (
    (rule.country ? 1 : 0) +
    (rule.subscriberTier ? 1 : 0) +
    (rule.serviceType ? 1 : 0)
  );
}

/**
 * Strict deterministic comparator for sorting matching rules so the winner is first.
 * Ordering: specificity DESC -> priority DESC -> effectiveFrom DESC -> id ASC.
 */
export function compareBySpecificityThenPriorityThenDateThenId(
  a: CommissionRuleRow,
  b: CommissionRuleRow,
): number {
  return (
    specificityScore(b) - specificityScore(a) ||
    b.priority - a.priority ||
    b.effectiveFrom.getTime() - a.effectiveFrom.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
