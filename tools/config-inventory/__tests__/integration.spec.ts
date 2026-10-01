/**
 * Integration tests: run the tooling wired to the ACTUAL BidClean repo tree.
 * These are the deliverable's acceptance gate (1 run each, not 100 iterations —
 * behavior does not vary with input here).
 */

import { join } from 'node:path';
import { runInventory } from '../inventory';
import { runAllScanners, buildCatalog } from '../merge';
import { reconcile } from '../reconcile';
import { parseEnvExample } from '../sources/env-example-parser';
import { JUSTIFIED_ORPHAN_NAMES } from '../orphan-justifications';

/** Resolve the repo root from this test file location (tools/config-inventory/__tests__). */
const REPO_ROOT = join(__dirname, '..', '..', '..');

describe('integration — real repo tree', () => {
  it('reconciles with zero MISSING and zero unjustified ORPHANED; every var has provenance', () => {
    const declared = runAllScanners(REPO_ROOT);
    const catalog = buildCatalog(declared);
    const env = parseEnvExample(join(REPO_ROOT, '.env.example'));
    const result = reconcile(declared, env);

    const missing = [...new Set(result.missingInEnvExample.map((v) => v.name))];
    expect(missing).toEqual([]);

    const unjustifiedOrphans = result.orphanedInEnvExample
      .map((e) => e.name)
      .filter((name) => !JUSTIFIED_ORPHAN_NAMES.has(name));
    expect(unjustifiedOrphans).toEqual([]);

    for (const variable of catalog) {
      expect(variable.provenance.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('has no SECRET_ON_CLIENT finding and the AI surface holds no storage credential', () => {
    const { report } = runInventory({ repoRoot: REPO_ROOT });

    const secretOnClient = report.findings.filter((f) => f.code === 'SECRET_ON_CLIENT');
    expect(secretOnClient).toEqual([]);

    const aiStorage = report.variables.filter(
      (v) => v.surface === 'AI' && /^(MINIO_|AWS_ACCESS_KEY_ID$|AWS_SECRET_ACCESS_KEY$|S3_)/.test(v.name),
    );
    expect(aiStorage).toEqual([]);
  });

  it('reports the known mcp.json secret as a blocking SECRET_EXPOSURE (untouched), so it is not compliant', () => {
    const { report } = runInventory({ repoRoot: REPO_ROOT });

    const exposures = report.findings.filter((f) => f.code === 'SECRET_EXPOSURE');
    // The tracked .kiro/settings/mcp.json RevenueCat key is the expected exposure.
    expect(exposures.some((f) => (f.variable ?? '').includes('mcp.json'))).toBe(true);
    expect(exposures.every((f) => f.blocking)).toBe(true);
    // A discovered exposure means the config is NOT marked compliant.
    expect(report.compliant).toBe(false);
    // The finding never contains the secret value itself.
    for (const f of exposures) {
      expect(f.detail).toContain('value not shown');
    }
  });
});
