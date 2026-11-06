/**
 * service-health probe — LIVENESS ONLY, never integration proof.
 *
 * Probes a health/readiness endpoint (or the defined minimal liveness probe) and
 * requires GREEN. Its evidence EXPLICITLY records that a health 200 is a liveness
 * signal, not edge proof — the audit never reduces a component to GET /health.
 * The evaluator enforces that a SERVICE_HEALTH PASS never by itself satisfies an
 * INTER_SERVICE_EDGE / EXTERNAL_INTEGRATION item (Property 2).
 */

import type { ChecklistItem, ProbeResult } from '../checklist/checklist.model';
import { type ProbeContext, probeResult } from './probe.types';
import { observeHealth, observeTcp, resolveLivenessUrl, resolveTcpEndpoint } from './live-fetch';

/** A health observation the host supplies for a target. */
export interface HealthObservation {
  /** HTTP status (or synthesized status for a minimal liveness probe). */
  readonly httpStatus: number;
  /** Optional body "status" field, e.g. "ok", "up". */
  readonly reportedStatus?: string;
}

/** The suffix that marks every health evidence string as liveness-only. */
export const LIVENESS_ONLY_MARKER = 'liveness signal only — not edge proof';

/**
 * Interpret a health observation. A 2xx (and a non-"down" reported status) →
 * PASS; anything else → FAIL. Evidence always carries the liveness-only marker.
 */
export function interpretHealth(subject: string, observation: HealthObservation): ProbeResult {
  const green =
    observation.httpStatus >= 200 &&
    observation.httpStatus < 300 &&
    observation.reportedStatus !== 'down';
  return probeResult(green ? 'PASS' : 'FAIL', {
    subject,
    outcome: green ? 'healthy (GREEN)' : `unhealthy (status ${observation.httpStatus})`,
    detail: LIVENESS_ONLY_MARKER,
  });
}

/**
 * The runnable probe. When the live stack is unavailable it returns an honest
 * FAIL. When available (Fase 2) it issues a REAL bounded GET to the component's
 * resolved liveness URL and interprets the observed status. A component with no
 * local HTTP liveness endpoint (Postgres/Redis TCP, CPU binaries, VPS-only infra)
 * fails honestly with "no local HTTP liveness endpoint" rather than a fake 200.
 */
export const serviceHealthProbe = async (
  ctx: ProbeContext,
  item: ChecklistItem,
): Promise<ProbeResult> => {
  const subject = item.invariant.description;
  if (!ctx.liveStackAvailable) {
    return probeResult('FAIL', {
      subject,
      outcome: 'health unknown',
      detail: `stack not running — Fase 2; ${LIVENESS_ONLY_MARKER}`,
    });
  }
  const probeId = item.probes[ctx.environment]?.probeRef.probeId ?? '';
  const url = resolveLivenessUrl(probeId, ctx.targets);
  if (url !== undefined) {
    return interpretHealth(subject, await observeHealth(url));
  }
  const tcp = resolveTcpEndpoint(probeId);
  if (tcp !== undefined) {
    return interpretHealth(subject, await observeTcp(tcp.host, tcp.port));
  }
  return probeResult('FAIL', {
    subject,
    outcome: 'health unknown',
    detail: `no local HTTP liveness endpoint; ${LIVENESS_ONLY_MARKER}`,
  });
};
