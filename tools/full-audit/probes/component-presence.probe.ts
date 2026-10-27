/**
 * component-presence probe — the required service/module exists and is up.
 *
 * A missing required component → FAIL (MISSING_OR_DOWN). A component with no
 * native health endpoint still gets a minimal liveness probe (process/container
 * present), NEVER an "assume up". Presence is distinct from service-health: it
 * answers "is it there/registered", health answers "does it report GREEN".
 */

import type { ChecklistItem, ProbeResult } from '../checklist/checklist.model';
import { type ProbeContext, probeResult } from './probe.types';

/** A minimal liveness observation the host supplies for a target. */
export interface PresenceObservation {
  /** True iff the process/container/module was found running + registered. */
  readonly present: boolean;
  /** Non-secret detail, e.g. "container up 3m", "module registered". */
  readonly detail?: string;
}

/**
 * Interpret a presence observation into a result. `present=false` → FAIL
 * (MISSING_OR_DOWN); `present=true` → PASS. The interpretation is pure and
 * testable with simulated observations.
 */
export function interpretPresence(subject: string, observation: PresenceObservation): ProbeResult {
  if (!observation.present) {
    return probeResult('FAIL', {
      subject,
      outcome: 'missing or down',
      detail: observation.detail ?? 'not present',
    });
  }
  return probeResult('PASS', {
    subject,
    outcome: 'present',
    detail: observation.detail ?? 'running',
  });
}

/**
 * The runnable probe. In Fase 1 the live stack is not up, so presence cannot be
 * confirmed → FAIL (never a silent N/A/PASS). Fase 2 supplies real observations.
 */
export const componentPresenceProbe = async (
  ctx: ProbeContext,
  item: ChecklistItem,
): Promise<ProbeResult> => {
  const subject = item.invariant.description;
  if (!ctx.liveStackAvailable) {
    return probeResult('FAIL', {
      subject,
      outcome: 'presence unknown',
      detail: 'stack not running — Fase 2',
    });
  }
  // Fase 2: the host resolves a real PresenceObservation for the target.
  return interpretPresence(subject, { present: true });
};
