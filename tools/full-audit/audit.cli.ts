/**
 * Audit CLI — `audit --env local|vps`.
 *
 * Runs a full audit for one environment: reconcile the registry FIRST (block on
 * REGISTRY_STALE), build the checklist, run every applicable probe, record
 * results, then serialize `reports/readiness-report.{env}.json`. When BOTH
 * environment reports exist it invokes the pure evaluator + reporter to emit
 * `reports/findings.json` and refresh `docs/deployment/READINESS-CHECKLIST.md`.
 *
 * In Fase 1 the live stack is not up, so edge/integration/journey probes return
 * an honest FAIL ("target unreachable — Fase 2"); the CLI runs today and produces
 * a NOT_READY report whose FAILs are exactly the ones Fase 2 must turn green.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { auditEnvironment, type EnvironmentAuditResult } from './audit';
import { loadRegistryFile } from './registry/registry-loader';
import { DECLARED_COMPONENTS } from './registry/declared-components';
import { evaluateReadiness } from './evaluate/readiness-evaluator';
import { reportFindings } from './evaluate/findings-reporter';
import { resolveTargets, isLiveStackAvailable } from './config/targets';
import { renderChecklistMarkdown } from './reports/render-checklist';
import type { ChecklistItem, Environment, Finding } from './checklist/checklist.model';

const TOOL_DIR = join('tools', 'full-audit');
const REGISTRY_YAML = join(TOOL_DIR, 'registry', 'component-registry.yaml');
const REPORTS_DIR = join(TOOL_DIR, 'reports');
const CHECKLIST_DOC = join('docs', 'deployment', 'READINESS-CHECKLIST.md');

/** Parsed CLI options. */
interface CliOptions {
  readonly environment: Environment;
  readonly repoRoot: string;
}

/** Parse argv into options. Requires `--env local|vps`. */
export function parseArgs(argv: readonly string[]): CliOptions {
  const envArg = argv.find((arg) => arg.startsWith('--env='));
  const envFlagIndex = argv.indexOf('--env');
  const rawEnv = envArg
    ? envArg.slice('--env='.length)
    : envFlagIndex >= 0
      ? argv[envFlagIndex + 1]
      : undefined;
  if (rawEnv !== 'local' && rawEnv !== 'vps') {
    throw new Error("usage: audit --env local|vps");
  }
  const rootArg = argv.find((arg) => arg.startsWith('--repo-root='));
  const repoRoot = rootArg ? resolve(rootArg.slice('--repo-root='.length)) : resolve(process.cwd());
  return { environment: rawEnv, repoRoot };
}

/** Write a file, creating parent directories as needed. */
function writeArtifact(absolutePath: string, content: string): void {
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, 'utf8');
}

/** The persisted per-environment report shape. */
interface EnvironmentReportFile {
  readonly environment: Environment;
  readonly generatedAt: string;
  readonly registryFindings: readonly Finding[];
  readonly items: readonly ChecklistItem[];
}

/** Serialize a per-environment audit result to its JSON report path. */
function writeEnvironmentReport(repoRoot: string, result: EnvironmentAuditResult): void {
  const file: EnvironmentReportFile = {
    environment: result.environment,
    generatedAt: new Date().toISOString(),
    registryFindings: result.registryFindings,
    items: result.items,
  };
  const path = join(repoRoot, REPORTS_DIR, `readiness-report.${result.environment}.json`);
  writeArtifact(path, `${JSON.stringify(file, null, 2)}\n`);
}

/** Read a previously-written per-environment report if it exists. */
function readEnvironmentReport(
  repoRoot: string,
  environment: Environment,
): EnvironmentReportFile | undefined {
  const path = join(repoRoot, REPORTS_DIR, `readiness-report.${environment}.json`);
  if (!existsSync(path)) {
    return undefined;
  }
  return JSON.parse(readFileSync(path, 'utf8')) as EnvironmentReportFile;
}

/** Run the CLI and return the process exit code (0 READY, 1 NOT_READY/stale). */
export async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv);
  const registry = loadRegistryFile(join(options.repoRoot, REGISTRY_YAML));

  const result = await auditEnvironment({
    environment: options.environment,
    registry,
    declared: DECLARED_COMPONENTS,
    targets: resolveTargets(options.environment),
    liveStackAvailable: isLiveStackAvailable(),
  });
  writeEnvironmentReport(options.repoRoot, result);

  if (result.registryFindings.length > 0) {
    const detail = result.registryFindings
      .map((finding) => `  [REGISTRY_STALE] ${finding.invariantId}: ${finding.evidence}`)
      .join('\n');
    process.stderr.write(
      `full-audit(${options.environment}): registry stale — reconcile first\n${detail}\n`,
    );
    return 1;
  }

  return finalizeIfBothPresent(options);
}

/**
 * When both environment reports exist, evaluate + report + refresh the human
 * checklist. When only one exists (the typical Fase-1 `--env local` run) emit a
 * single-environment honest verdict so the operator sees the Fase-2 FAILs today.
 */
function finalizeIfBothPresent(options: CliOptions): number {
  const local = readEnvironmentReport(options.repoRoot, 'local');
  const vps = readEnvironmentReport(options.repoRoot, 'vps');

  const report = evaluateReadiness({
    local: local?.items ?? [],
    vps: vps?.items ?? [],
    storeArtifactsValid: false, // Fase 1: artifacts not built → NOT_READY (honest)
    carriedFindings: [...(local?.registryFindings ?? []), ...(vps?.registryFindings ?? [])],
  });
  const findings = reportFindings(report);

  writeArtifact(
    join(options.repoRoot, REPORTS_DIR, 'findings.json'),
    `${JSON.stringify({ verdict: report.verdict, findings }, null, 2)}\n`,
  );
  writeArtifact(
    join(options.repoRoot, CHECKLIST_DOC),
    renderChecklistMarkdown(report.items, findings, report.verdict),
  );

  const byReason = summarizeFindings(findings);
  process.stdout.write(
    `full-audit(${options.environment}): verdict=${report.verdict}, ` +
      `${findings.length} findings — ${byReason}\n`,
  );
  return report.verdict === 'READY' ? 0 : 1;
}

/** One-line summary of finding counts by reason. */
function summarizeFindings(findings: readonly Finding[]): string {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    counts.set(finding.reason, (counts.get(finding.reason) ?? 0) + 1);
  }
  return [...counts.entries()].map(([reason, count]) => `${reason}:${count}`).join(', ') || 'none';
}

// Execute when run directly (not when imported by tests).
if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`full-audit failed: ${String(error)}\n`);
      process.exitCode = 1;
    });
}
