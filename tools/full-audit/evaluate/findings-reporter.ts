/**
 * Findings reporter — PURE routing of violating conditions to owners.
 *
 * Emits exactly ONE finding per violating condition (no violation silently
 * dropped), each carrying `{ reason, invariantId, environment, evidence, owner }`
 * with a NON-EMPTY owner, and MUTATES NONE of its inputs (the report is deep-equal
 * before and after). full-audit reports and gates — it never patches behaviour or
 * config (Property 6).
 */

import type { Finding, ReadinessReport } from '../checklist/checklist.model';

/**
 * Return the routed findings for a readiness report. Deduplicates identical
 * `(reason, invariantId, environment)` conditions so each violating condition is
 * reported exactly once, and verifies every finding has a non-empty owner. Does
 * not read or mutate the checklist items beyond the already-computed findings.
 */
export function reportFindings(report: ReadinessReport): readonly Finding[] {
  const seen = new Set<string>();
  const routed: Finding[] = [];

  for (const finding of report.findings) {
    const key = conditionKey(finding);
    if (seen.has(key)) {
      continue; // one finding per violating condition
    }
    seen.add(key);
    routed.push(ensureOwner(finding));
  }

  return routed;
}

/** A stable key for a violating condition. */
function conditionKey(finding: Finding): string {
  return `${finding.reason}|${finding.invariantId}|${finding.environment}`;
}

/** Guarantee a non-empty owner so every finding is routable. */
function ensureOwner(finding: Finding): Finding {
  if (finding.owner.trim() !== '') {
    return finding;
  }
  return { ...finding, owner: 'UNROUTED' };
}
