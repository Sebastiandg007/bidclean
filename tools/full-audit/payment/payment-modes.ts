/**
 * Payment-mode policy — the automatic audit can STRUCTURALLY never move real money.
 *
 * External-payment edges are validated in three explicitly-separated modes:
 *   - sandbox            → automatic readiness E2E (no real money, even on VPS)
 *   - live-readiness     → automatic non-transacting reachability/auth probe (no charge)
 *   - operator-live-money → a MANUAL, operator-gated real transaction, NEVER part
 *                            of the automatic audit.
 *
 * `assertAutomaticModeAllowed` is the gate: an automatic run may only use the
 * first two; a real transaction is only reachable through an explicit operator
 * action outside the automatic audit.
 */

export type PaymentMode = 'sandbox' | 'live-readiness' | 'operator-live-money';

/** The modes an automatic audit invocation is permitted to use. */
export const AUTOMATIC_MODES: readonly PaymentMode[] = ['sandbox', 'live-readiness'];

/** Raised when an automatic run requests a real-money transaction. */
export class LiveMoneyNotAutomaticError extends Error {
  constructor(mode: PaymentMode) {
    super(
      `payment mode '${mode}' is a real transaction and can only be an explicit, ` +
        `operator-gated action — it is never part of the automatic audit`,
    );
    this.name = 'LiveMoneyNotAutomaticError';
  }
}

/**
 * Assert the payment mode is permitted in an automatic audit. Permits `sandbox`
 * and `live-readiness`; THROWS on `operator-live-money`.
 */
export function assertAutomaticModeAllowed(mode: PaymentMode): void {
  if (!AUTOMATIC_MODES.includes(mode)) {
    throw new LiveMoneyNotAutomaticError(mode);
  }
}

/** True iff the mode is allowed in an automatic run (does not throw). */
export function isAutomaticModeAllowed(mode: PaymentMode): boolean {
  return AUTOMATIC_MODES.includes(mode);
}
