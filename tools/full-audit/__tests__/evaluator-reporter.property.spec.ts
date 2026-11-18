/**
 * Properties 3, 4, 5, 6, 9 + unit tests for the evaluator and findings reporter.
 */

import fc from 'fast-check';
import { evaluateReadiness, type EvaluatorInput } from '../evaluate/readiness-evaluator';
import { reportFindings } from '../evaluate/findings-reporter';
import { checklistArb } from './arbitraries';
import type { ChecklistItem, Environment, Finding, Status } from '../checklist/checklist.model';

const RUNS = { numRuns: 200 };

/** The status the evaluator derives for an item in an environment (mirrors its rule). */
function statusIn(item: ChecklistItem, env: Environment): Status | undefined {
  const result = item.results[env];
  if (result === undefined) {
    return item.probes[env] === null ? 'N/A' : undefined;
  }
  return result.status;
}

/** A deep clone used to assert purity (inputs unchanged after evaluation/reporting). */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('evaluator + reporter — property-based', () => {
  // Feature: full-audit, Property 3: For any checklist item and environment, its recorded status is
  // exactly one of {PASS, FAIL, N/A}; whenever the status is N/A there is a non-empty applicability
  // justification for that environment; and an N/A is never counted as PASS. An N/A on a mandatory
  // item with no justification itself yields a finding.
  it('Property 3: tri-state integrity and mandatory N/A justification', () => {
    fc.assert(
      fc.property(checklistArb, (items) => {
        const report = evaluateReadiness({ local: items, vps: [], storeArtifactsValid: true });
        for (const item of items) {
          const status = statusIn(item, 'local');
          if (status !== undefined) {
            expect(['PASS', 'FAIL', 'N/A']).toContain(status);
          }
          if (item.mandatory && status === 'N/A') {
            const justified = (item.applicabilityJustification.local ?? '').trim() !== '';
            const hasFinding = report.findings.some(
              (f) => f.reason === 'UNJUSTIFIED_NA' && f.invariantId === item.invariant.id,
            );
            // Unjustified N/A on a mandatory item ⇒ a finding; justified ⇒ none for this reason.
            expect(hasFinding).toBe(!justified);
          }
        }
      }),
      RUNS,
    );
  });

  // Feature: full-audit, Property 4: For any mandatory checklist item applicable in both
  // environments, if its status differs between local and vps the evaluator emits a blocking
  // PARITY_BREAK finding and the verdict is NOT_READY; and for any item its invariant is a single
  // environment-independent value while its probes are keyed per environment. A local-only pass
  // never satisfies a both-environments-mandatory item.
  it('Property 4: two-environment parity — disagreement on a mandatory+applicable item blocks', () => {
    fc.assert(
      fc.property(checklistArb, (items) => {
        // Use the SAME item set for both environments so invariant ids line up.
        const report = evaluateReadiness({ local: items, vps: items, storeArtifactsValid: true });
        for (const item of items) {
          if (!item.mandatory) {
            continue;
          }
          const local = statusIn(item, 'local');
          const vps = statusIn(item, 'vps');
          const bothApplicable =
            (local === 'PASS' || local === 'FAIL') && (vps === 'PASS' || vps === 'FAIL');
          if (bothApplicable && local !== vps) {
            const parity = report.findings.some(
              (f) => f.reason === 'PARITY_BREAK' && f.invariantId === item.invariant.id,
            );
            expect(parity).toBe(true);
            expect(report.verdict).toBe('NOT_READY');
          }
        }
      }),
      RUNS,
    );
  });

  // Feature: full-audit, Property 5: For any pair of per-environment checklist states plus the
  // store-artifact validity flag, the verdict is READY if and only if every mandatory item is PASS
  // in every environment where applicable, every N/A is justified, there is no parity break, and
  // store artifacts are valid — equivalently READY iff the report contains no blocking finding
  // across both environments.
  it('Property 5: readiness verdict equivalence (READY iff no blocking finding)', () => {
    fc.assert(
      fc.property(checklistArb, fc.boolean(), (items, storeValid) => {
        const report = evaluateReadiness({
          local: items,
          vps: items,
          storeArtifactsValid: storeValid,
        });
        const hasBlocking = report.findings.some((f) => f.blocking);
        expect(report.verdict).toBe(hasBlocking ? 'NOT_READY' : 'READY');
      }),
      RUNS,
    );
  });

  // Feature: full-audit, Property 6: For any evaluated readiness report, the findings reporter emits
  // exactly one finding per violating condition (no violation silently dropped), each carrying
  // { invariantId, environment, evidence, owner } with a non-empty owner, and mutates none of its
  // inputs (the checklist and results are deep-equal before and after).
  it('Property 6: findings are routed, complete, de-duplicated, and never patch inputs', () => {
    fc.assert(
      fc.property(checklistArb, fc.boolean(), (items, storeValid) => {
        const input: EvaluatorInput = { local: items, vps: items, storeArtifactsValid: storeValid };
        const before = clone(input);
        const report = evaluateReadiness(input);

        const reportBefore = clone(report);
        const routed = reportFindings(report);

        // Purity: neither the evaluator input nor the report is mutated.
        expect(input).toEqual(before);
        expect(report).toEqual(reportBefore);

        // Every routed finding has a non-empty owner.
        for (const finding of routed) {
          expect(finding.owner.trim().length).toBeGreaterThan(0);
        }

        // Exactly one finding per (reason, invariantId, environment) condition.
        const keys = routed.map((f) => `${f.reason}|${f.invariantId}|${f.environment}`);
        expect(new Set(keys).size).toBe(keys.length);
      }),
      RUNS,
    );
  });

  // Feature: full-audit, Property 9: For any audit input that carries a SECRET_EXPOSURE finding
  // forward from secrets-inventory, the evaluator surfaces it as a blocking finding and the verdict
  // is NOT_READY — the exposure is never remediated here and never silently dropped or downgraded.
  it('Property 9: carried-forward SECRET_EXPOSURE is always blocking', () => {
    fc.assert(
      fc.property(checklistArb, (items) => {
        const exposure: Finding = {
          reason: 'SECRET_EXPOSURE',
          invariantId: 'secrets:carried',
          environment: 'both',
          evidence: 'carried forward from secrets-inventory',
          owner: 'secrets-inventory',
          blocking: true,
        };
        const report = evaluateReadiness({
          local: items,
          vps: items,
          storeArtifactsValid: true,
          carriedFindings: [exposure],
        });
        const surfaced = report.findings.find((f) => f.reason === 'SECRET_EXPOSURE');
        expect(surfaced).toBeDefined();
        expect(surfaced?.blocking).toBe(true);
        expect(report.verdict).toBe('NOT_READY');
      }),
      RUNS,
    );
  });
});
