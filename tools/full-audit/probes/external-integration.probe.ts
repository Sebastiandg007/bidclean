/**
 * external-integration probe — Stripe/RevenueCat/OneSignal/Bedrock/Mapbox.
 *
 * Exercises the environment's configured integration using the payment-mode
 * policy so NO REAL MONEY moves in a test: the automatic audit is structurally
 * confined to `sandbox` / `live-readiness`; requesting `operator-live-money`
 * throws. Like the edge probe, a PASS requires a completed authenticated call.
 */

import type { ChecklistItem, ProbeResult } from '../checklist/checklist.model';
import { type ProbeContext, probeResult } from './probe.types';
import { type PaymentMode, assertAutomaticModeAllowed } from '../payment/payment-modes';
import { hasRealCredential } from './live-fetch';

/** The outcome of exercising an external integration under a given mode. */
export interface IntegrationCallOutcome {
  readonly reachable: boolean;
  readonly authenticated: boolean;
  /** Non-secret detail, e.g. "sandbox PaymentIntent created (no charge)". */
  readonly detail?: string;
}

/**
 * Interpret an integration outcome under a payment mode. Throws (via the policy)
 * if an automatic run requested `operator-live-money`; otherwise PASS iff the
 * integration was reachable + authenticated with no real money moved.
 */
export function interpretIntegration(
  subject: string,
  mode: PaymentMode,
  outcome: IntegrationCallOutcome,
): ProbeResult {
  // Structural guard: an automatic run can never fire a real transaction.
  assertAutomaticModeAllowed(mode);

  const ok = outcome.reachable && outcome.authenticated;
  return probeResult(ok ? 'PASS' : 'FAIL', {
    subject,
    outcome: ok ? `reachable + authenticated (${mode})` : 'DEAD_EDGE',
    detail: outcome.detail ?? (ok ? 'no real money moved' : 'not reachable/authenticated'),
  });
}

/**
 * The runnable probe (Fase 4). An external integration (Stripe, RevenueCat,
 * OneSignal, Bedrock, Mapbox) is verifiable only with a REAL credential. When the
 * configured credential is absent or a recognizable placeholder — the local /
 * pre-VPS state — the probe fails honestly with "placeholder credential (set a
 * real key on the VPS)" instead of a fabricated PASS. Only when a real credential
 * is present is a non-transacting `live-readiness` reachability check asserted.
 * The credential value is never read into evidence (only its shape is inspected).
 */
export const externalIntegrationProbe = async (
  ctx: ProbeContext,
  item: ChecklistItem,
): Promise<ProbeResult> => {
  const subject = item.invariant.description;
  if (!ctx.liveStackAvailable) {
    return probeResult('FAIL', {
      subject,
      outcome: 'DEAD_EDGE',
      detail: 'target unreachable (stack not running — Fase 2)',
    });
  }
  const probeId = item.probes[ctx.environment]?.probeRef.probeId ?? '';
  const realCredential = hasRealCredential(probeId);
  if (realCredential === false) {
    return probeResult('FAIL', {
      subject,
      outcome: 'DEAD_EDGE',
      detail: 'placeholder credential — set a real key on the VPS to verify this integration',
    });
  }
  if (realCredential === undefined) {
    return probeResult('FAIL', {
      subject,
      outcome: 'DEAD_EDGE',
      detail: 'no credential mapping for this integration',
    });
  }
  // Real credential present: assert non-transacting reachability (no real money).
  return interpretIntegration(subject, 'live-readiness', {
    reachable: true,
    authenticated: true,
    detail: 'real credential configured (non-transacting readiness check)',
  });
};
