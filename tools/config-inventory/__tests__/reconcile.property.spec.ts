/**
 * Property-based tests for reconciliation + authority chain (Properties 1-4).
 * Uses fast-check, minimum 100 runs per property.
 */

import fc from 'fast-check';
import { reconcile, reconciliationFindings } from '../reconcile';
import { mergeDeclared } from '../merge';
import type { DeclaredVariable, OrphanJustification } from '../inventory.model';
import type { EnvExampleEntry } from '../sources/env-example-parser';
import { declaredListArb, envEntryListArb } from './arbitraries';

const RUNS = { numRuns: 200 };

/** Names present in an env-example set. */
function envNames(entries: EnvExampleEntry[]): Set<string> {
  return new Set(entries.map((entry) => entry.name));
}

/** Distinct declared names. */
function declaredNames(declared: DeclaredVariable[]): Set<string> {
  return new Set(declared.map((variable) => variable.name));
}

describe('reconcile — property-based', () => {
  // Feature: secrets-inventory, Property 1: For any set of declared variables across the full
  // source taxonomy and any .env.example set, after reconciliation every declared variable either
  // appears in .env.example or is reported MISSING_IN_ENV_EXAMPLE; none is silently dropped, and
  // every catalogued variable carries at least one DiscoveryProvenance.
  it('Property 1: completeness across the full source taxonomy', () => {
    fc.assert(
      fc.property(declaredListArb, envEntryListArb, (declared, env) => {
        const result = reconcile(declared, env);
        const present = envNames(env);
        const findings = reconciliationFindings(result);
        const missingReported = new Set(
          findings.filter((f) => f.code === 'MISSING_IN_ENV_EXAMPLE').map((f) => f.variable),
        );

        for (const name of declaredNames(declared)) {
          const accountedFor = present.has(name) || missingReported.has(name);
          expect(accountedFor).toBe(true);
        }

        // Every merged catalog variable carries at least one provenance.
        for (const merged of mergeDeclared(declared)) {
          expect(merged.provenance.length).toBeGreaterThanOrEqual(1);
        }
      }),
      RUNS,
    );
  });

  // Feature: secrets-inventory, Property 2: For any .env.example set and declared set, every
  // .env.example entry with no consumer is reported ORPHANED_ENV_EXAMPLE unless it carries a valid
  // structured OrphanJustification, and every entry that has a consumer is not reported an orphan.
  it('Property 2: orphan detection is exhaustive', () => {
    const justificationArb: fc.Arbitrary<OrphanJustification> = fc.record({
      type: fc.constantFrom('LEGACY', 'BUILD_ONLY', 'EXTERNAL_TOOL', 'DEPRECATED'),
      owner: fc.constantFrom('team-a', 'team-b'),
      expiresAt: fc.constantFrom('2026-01-01', '2027-01-01'),
    });

    fc.assert(
      fc.property(
        declaredListArb,
        envEntryListArb,
        fc.array(fc.tuple(fc.string(), justificationArb)),
        (declared, env, _justPairs) => {
          const declaredSet = declaredNames(declared);
          // Justify a subset: the orphan names that happen to be in the env set.
          const justified = new Set(
            env.filter((e) => !declaredSet.has(e.name)).map((e) => e.name).slice(0, 2),
          );
          const result = reconcile(declared, env);
          const findings = reconciliationFindings(result, justified);
          const orphanReported = new Set(
            findings.filter((f) => f.code === 'ORPHANED_ENV_EXAMPLE').map((f) => f.variable),
          );

          for (const entry of env) {
            const hasConsumer = declaredSet.has(entry.name);
            if (hasConsumer) {
              expect(orphanReported.has(entry.name)).toBe(false);
            } else if (!justified.has(entry.name)) {
              expect(orphanReported.has(entry.name)).toBe(true);
            } else {
              expect(orphanReported.has(entry.name)).toBe(false);
            }
          }
        },
      ),
      RUNS,
    );
  });

  // Feature: secrets-inventory, Property 3: For any declared set D and env-example set E, the
  // reconcile result's missingInEnvExample equals exactly names in D but not E, and
  // orphanedInEnvExample equals exactly names in E but not D (set-difference symmetry).
  it('Property 3: reconciliation missing/orphan symmetry', () => {
    fc.assert(
      fc.property(declaredListArb, envEntryListArb, (declared, env) => {
        const result = reconcile(declared, env);
        const dNames = declaredNames(declared);
        const eNames = envNames(env);

        const expectedMissing = [...dNames].filter((n) => !eNames.has(n)).sort();
        const expectedOrphan = [...eNames].filter((n) => !dNames.has(n)).sort();

        const actualMissing = [...new Set(result.missingInEnvExample.map((v) => v.name))].sort();
        const actualOrphan = [...new Set(result.orphanedInEnvExample.map((e) => e.name))].sort();

        expect(actualMissing).toEqual(expectedMissing);
        expect(actualOrphan).toEqual(expectedOrphan);

        // No overlap between the two sets.
        for (const name of actualMissing) {
          expect(actualOrphan).not.toContain(name);
        }
      }),
      RUNS,
    );
  });

  // Feature: secrets-inventory, Property 4: For any reconciled inventory, no variable exists in the
  // final .env.example shape unless it is present in the declared set or carries a structured
  // OrphanJustification; an unrecognized declaration lacking a valid justification always produces
  // a finding. Existence/classification/requiredness are never sourced from .env.example.
  it('Property 4: authority chain forbids unrecognized declarations', () => {
    fc.assert(
      fc.property(declaredListArb, envEntryListArb, (declared, env) => {
        const declaredSet = declaredNames(declared);
        const result = reconcile(declared, env);
        const findings = reconciliationFindings(result, new Set());
        const orphanReported = new Set(
          findings.filter((f) => f.code === 'ORPHANED_ENV_EXAMPLE').map((f) => f.variable),
        );

        for (const entry of env) {
          const recognized = declaredSet.has(entry.name);
          if (!recognized) {
            // Unrecognized (no justification supplied) always yields a finding.
            expect(orphanReported.has(entry.name)).toBe(true);
          }
        }
      }),
      RUNS,
    );
  });
});
