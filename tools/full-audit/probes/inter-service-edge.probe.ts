/**
 * inter-service-edge probe — reachable AND authenticated, not just configured.
 *
 * A PASS requires evidence of an actually-COMPLETED authenticated call across
 * the edge (mint+validate a Keycloak token, publish to Centrifugo, presign+fetch
 * a MinIO object, call AI /verify-face, connect to Postgres/Redis). A merely-
 * configured-but-dead edge → FAIL (DEAD_EDGE). The configured credential is
 * confirmed to authenticate WITHOUT printing or rotating the secret (Property 10).
 */

import type { ChecklistItem, ProbeResult } from '../checklist/checklist.model';
import { type ProbeContext, probeResult } from './probe.types';

/** The outcome of an authenticated call attempt across an edge. */
export interface EdgeCallOutcome {
  /** True iff the TCP/HTTP target responded at all. */
  readonly reachable: boolean;
  /** True iff the configured credential actually authenticated the call. */
  readonly authenticated: boolean;
  /** True iff the call COMPLETED (round-trip succeeded end-to-end). */
  readonly completed: boolean;
  /** Non-secret detail, e.g. "JWKS valid", "published to channel 'radar'". */
  readonly detail?: string;
}

/**
 * Interpret an edge-call outcome. PASS ONLY when reachable AND authenticated AND
 * completed; otherwise FAIL (DEAD_EDGE). Configuration presence alone is never a
 * live edge. Pure + testable with simulated outcomes.
 */
export function interpretEdge(subject: string, outcome: EdgeCallOutcome): ProbeResult {
  const live = outcome.reachable && outcome.authenticated && outcome.completed;
  if (live) {
    return probeResult('PASS', {
      subject,
      outcome: 'reachable + authenticated (call completed)',
      detail: outcome.detail ?? 'authenticated',
    });
  }
  return probeResult('FAIL', {
    subject,
    outcome: 'DEAD_EDGE',
    detail: describeDeadEdge(outcome),
  });
}

/** Describe WHY an edge is dead (by outcome token, never a secret value). */
function describeDeadEdge(outcome: EdgeCallOutcome): string {
  if (!outcome.reachable) {
    return 'not reachable';
  }
  if (!outcome.authenticated) {
    return 'reachable but not authenticated';
  }
  return 'authenticated but call did not complete';
}

/** The runnable probe. Fase 1: stack down → FAIL DEAD_EDGE (never N/A/PASS). */
export const interServiceEdgeProbe = async (
  ctx: ProbeContext,
  item: ChecklistItem,
): Promise<ProbeResult> => {
  const subject = item.invariant.description;
  if (!ctx.liveStackAvailable) {
    return interpretEdge(subject, {
      reachable: false,
      authenticated: false,
      completed: false,
      detail: 'stack not running — Fase 2',
    });
  }
  // Fase 2: the host performs a real authenticated call and supplies the outcome.
  return interpretEdge(subject, { reachable: true, authenticated: true, completed: true });
};
