/**
 * CLI entry point for the configuration inventory.
 *
 * Runs the full pipeline against the repo, writes the presentation artifacts
 * (inventory doc, reconciled `.env.example` shape, findings JSON), prints a
 * summary, and exits non-zero when any blocking finding exists — so CI fails
 * loudly on drift or exposure. Runnable via `ts-node tools/config-inventory/inventory.cli.ts`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { runInventory } from './inventory';
import {
  renderCatalogJson,
  renderFindingsJson,
  renderInventoryDoc,
  renderReconciledEnvExample,
} from './report';

/** Output paths, relative to the repo root. */
const OUTPUT_PATHS = {
  doc: join('docs', 'CONFIGURATION-INVENTORY.md'),
  reconciledEnv: join('tools', 'config-inventory', 'out', '.env.example.reconciled'),
  findingsJson: join('tools', 'config-inventory', 'out', 'findings.json'),
  catalogJson: join('tools', 'config-inventory', 'out', 'catalog.json'),
} as const;

/** Whether the CLI should write artifacts (default) or only check (`--check`). */
interface CliOptions {
  readonly repoRoot: string;
  readonly write: boolean;
}

/** Parse CLI args into options. `--check` runs read-only (CI gate mode). */
function parseArgs(argv: readonly string[]): CliOptions {
  const write = !argv.includes('--check');
  const rootArg = argv.find((arg) => arg.startsWith('--repo-root='));
  const repoRoot = rootArg ? resolve(rootArg.slice('--repo-root='.length)) : resolve(process.cwd());
  return { repoRoot, write };
}

/** Write a file, creating parent directories as needed. */
function writeArtifact(absolutePath: string, content: string): void {
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, 'utf8');
}

/** Run the CLI and return the process exit code (0 compliant, 1 blocking). */
export function main(argv: readonly string[]): number {
  const options = parseArgs(argv);
  const { report } = runInventory({ repoRoot: options.repoRoot });

  if (options.write) {
    writeArtifact(join(options.repoRoot, OUTPUT_PATHS.doc), renderInventoryDoc(report));
    writeArtifact(
      join(options.repoRoot, OUTPUT_PATHS.reconciledEnv),
      renderReconciledEnvExample(report.variables),
    );
    writeArtifact(join(options.repoRoot, OUTPUT_PATHS.findingsJson), renderFindingsJson(report));
    writeArtifact(
      join(options.repoRoot, OUTPUT_PATHS.catalogJson),
      renderCatalogJson(report.variables),
    );
  }

  const blocking = report.findings.filter((finding) => finding.blocking);
  const summary =
    `config-inventory: ${report.variables.length} variables, ` +
    `${report.findings.length} findings (${blocking.length} blocking), ` +
    `compliant=${report.compliant}`;

  if (report.compliant) {
    process.stdout.write(`${summary}\n`);
    return 0;
  }

  // Non-compliant: surface each blocking finding on stderr (never the secret value).
  const detail = blocking
    .map((finding) => `  [${finding.code}] ${finding.variable ?? ''}: ${finding.detail}`)
    .join('\n');
  process.stderr.write(`${summary}\n${detail}\n`);
  return 1;
}

// Execute when run directly (not when imported by tests).
if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
