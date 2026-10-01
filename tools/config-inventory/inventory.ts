/**
 * Pure orchestration: run the six scanners, build the canonical catalog,
 * reconcile against `.env.example`, run the boundary + exposure checks, and
 * aggregate everything into a single `InventoryReport`.
 *
 * Kept free of process I/O (no writing files, no exit codes) so it is directly
 * testable; the CLI (`inventory.cli.ts`) wraps this with file writes + exit code.
 */

import { join } from 'node:path';
import type { Finding, InventoryReport } from './inventory.model';
import { buildCatalog, runAllScanners } from './merge';
import { checkBoundary } from './classify';
import { reconcile, reconciliationFindings } from './reconcile';
import { parseEnvExample } from './sources/env-example-parser';
import { scanExposure, type GitRunner, defaultGitRunner } from './exposure-scanner';
import { buildInventoryReport } from './report';
import { JUSTIFIED_ORPHAN_NAMES, ORPHAN_JUSTIFICATIONS } from './orphan-justifications';
import type { ConfigVariable } from './inventory.model';

/** Options for a full inventory run. */
export interface InventoryRunOptions {
  readonly repoRoot: string;
  readonly gitRunner?: GitRunner;
  readonly justifiedOrphanNames?: ReadonlySet<string>;
}

/** The full result of a run: the report plus the raw reconciliation diff. */
export interface InventoryRunResult {
  readonly report: InventoryReport;
}

const ENV_EXAMPLE_FILE = '.env.example';

/**
 * Run the full inventory pipeline against a repo.
 *
 * @param options - Repo root, optional git runner, optional justified orphans.
 * @returns The aggregated inventory report.
 */
export function runInventory(options: InventoryRunOptions): InventoryRunResult {
  const { repoRoot } = options;
  const gitRunner = options.gitRunner ?? defaultGitRunner;
  const justifiedOrphans = options.justifiedOrphanNames ?? JUSTIFIED_ORPHAN_NAMES;

  const declared = runAllScanners(repoRoot);
  const catalog = attachOrphanJustifications(buildCatalog(declared));

  const envEntries = parseEnvExample(join(repoRoot, ENV_EXAMPLE_FILE));
  const reconcileResult = reconcile(declared, envEntries);

  const findings: Finding[] = [
    ...reconciliationFindings(reconcileResult, justifiedOrphans),
    ...checkBoundary(catalog),
    ...scanExposure(repoRoot, gitRunner).findings,
  ];

  const report = buildInventoryReport(catalog, findings);
  return { report };
}

/**
 * Attach any registered `OrphanJustification` to a matching catalogued variable.
 * Most justified orphans are not read by any source, so this is a no-op for
 * them; it only annotates a variable when a source does read it (belt-and-braces
 * so the justification is visible in the model wherever the name appears).
 */
function attachOrphanJustifications(
  catalog: readonly ConfigVariable[],
): ConfigVariable[] {
  return catalog.map((variable) => {
    const justification = ORPHAN_JUSTIFICATIONS[variable.name];
    if (justification === undefined) {
      return variable;
    }
    return { ...variable, orphanJustification: justification };
  });
}
