/**
 * Extract the Stripe processing fee (in integer minor units) from a PaymentIntent
 * whose latest charge's balance transaction was expanded. Returns 0 when the fee is
 * not yet available (it may arrive later via the webhook and be reconciled).
 */
export function extractStripeFeeCents(intent: unknown): number {
  if (!intent || typeof intent !== 'object') {
    return 0;
  }
  const latestCharge = (intent as { latest_charge?: unknown }).latest_charge;
  if (!latestCharge || typeof latestCharge !== 'object') {
    return 0;
  }
  const balanceTx = (latestCharge as { balance_transaction?: unknown }).balance_transaction;
  if (balanceTx && typeof balanceTx === 'object' && 'fee' in balanceTx) {
    const fee = (balanceTx as { fee?: unknown }).fee;
    return typeof fee === 'number' ? fee : 0;
  }
  return 0;
}
