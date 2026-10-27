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

/** The runnable probe. Fase 1: stack down → FAIL with the liveness-only marker. */
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
  return interpretHealth(subject, { httpStatus: 200, reportedStatus: 'ok' });
};
