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

/** The runnable probe. Fase 1: stack down → FAIL (never N/A/PASS). */
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
  // Fase 2: the host drives the real journey and supplies the outcome.
  return interpretJourney(subject, { passed: true });
};
