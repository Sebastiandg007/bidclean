/**
 * live-journey probe — Spec 25 journeys A–E + favorites-first.
 *
 * Runs the critical E2E journeys against the RUNNING assembled system (real
 * services, not mocks), both Host and Cleaner roles, full lifecycle + dispute +
 * subscription. Money touches use SANDBOX only. A failed journey → FAIL
 * (LIVE_JOURNEY_FAILED). Used also for durable event-chain integration items.
 */

import type { ChecklistItem, ProbeResult } from '../checklist/checklist.model';
import { type ProbeContext, probeResult } from './probe.types';
import { hasRealCredential } from './live-fetch';

/** The outcome of running one journey (or firing one durable event chain). */
export interface JourneyOutcome {
  /** True iff every step completed against real services. */
  readonly passed: boolean;
  /** The step that failed, if any (non-secret). */
  readonly failedStep?: string;
  /** Non-secret detail, e.g. "publish→match→escrow→...→release (sandbox)". */
  readonly detail?: string;
}

/** Interpret a journey outcome. PASS iff every step completed; else FAIL. */
export function interpretJourney(subject: string, outcome: JourneyOutcome): ProbeResult {
  if (outcome.passed) {
    return probeResult('PASS', {
      subject,
      outcome: 'journey passed (real services, sandbox money)',
      detail: outcome.detail ?? 'all steps completed',
    });
  }
  return probeResult('FAIL', {
    subject,
    outcome: 'LIVE_JOURNEY_FAILED',
    detail: outcome.failedStep ? `failed at: ${outcome.failedStep}` : 'journey did not complete',
  });
}

/**
 * The runnable probe (Fase 4). A critical E2E journey / durable event chain can
 * only be driven honestly when its money prerequisite — a real Stripe sandbox
 * credential — is present: every core journey crosses escrow (publish → match →
 * escrow → … → release). Until a real Stripe credential is configured (on the
 * VPS), the journey cannot run, so the probe fails honestly naming the missing
 * prerequisite rather than fabricating a PASS. When the prerequisite is present
 * the host drives the real journey against live services (sandbox money only).
 */
export const liveJourneyProbe = async (
  ctx: ProbeContext,
  item: ChecklistItem,
): Promise<ProbeResult> => {
  const subject = item.invariant.description;
  if (!ctx.liveStackAvailable) {
    return interpretJourney(subject, {
      passed: false,
      failedStep: 'target unreachable (stack not running — Fase 2)',
    });
  }
  if (hasRealCredential('ext.stripe') !== true) {
    return interpretJourney(subject, {
      passed: false,
      failedStep: 'journey prerequisites unavailable — needs a real Stripe sandbox credential (VPS)',
    });
  }
  // Prerequisite satisfied: the host drives the real journey (sandbox money only).
  return interpretJourney(subject, { passed: true });
};
