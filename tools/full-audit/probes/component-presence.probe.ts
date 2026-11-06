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
import { observeHealth, observeTcp, resolveLivenessUrl, resolveTcpEndpoint } from './live-fetch';

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
 * The runnable probe. When the live stack is unavailable presence cannot be
 * confirmed → FAIL (never a silent N/A/PASS). When available (Fase 2) it issues a
 * REAL bounded GET: any HTTP response (even a 4xx/5xx) proves the process is
 * present + listening, while a transport failure (status 0) means missing/down.
 * A component with no local HTTP endpoint fails honestly rather than assuming up.
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
  const probeId = item.probes[ctx.environment]?.probeRef.probeId ?? '';
  const url = resolveLivenessUrl(probeId, ctx.targets);
  if (url !== undefined) {
    const observation = await observeHealth(url);
    return interpretPresence(subject, {
      present: observation.httpStatus > 0,
      detail:
        observation.httpStatus > 0 ? `listening (status ${observation.httpStatus})` : 'no response',
    });
  }
  const tcp = resolveTcpEndpoint(probeId);
  if (tcp !== undefined) {
    const observation = await observeTcp(tcp.host, tcp.port);
    return interpretPresence(subject, {
      present: observation.httpStatus > 0,
      detail: observation.httpStatus > 0 ? `tcp connect ${tcp.host}:${tcp.port}` : 'tcp refused',
    });
  }
  return interpretPresence(subject, {
    present: false,
    detail: 'no local HTTP endpoint to confirm presence',
  });
};
