/**
 * Audit orchestration — reconcile → build → probe → record (per environment).
 *
 * The authority chain, executed in order: reconcile the registry FIRST (block on
 * REGISTRY_STALE), build the checklist over the verified-complete registry, run
 * every applicable probe for the environment, and record each result on its item.
 * Probes that require the live stack return an honest FAIL in Fase 1 (never a
 * silent N/A/PASS), so the audit runs today and produces an honest NOT_READY.
 */

import type { ComponentEntry } from './registry/component-registry';
import type { DeclaredComponent } from './registry/declared-components';
import type { ChecklistItem, Environment, Finding } from './checklist/checklist.model';
import { reconcileRegistry } from './registry/registry-reconcile';
import { buildChecklist } from './checklist/checklist.builder';
import { probeFor, type ProbeContext } from './probes';

/** The result of auditing a single environment. */
export interface EnvironmentAuditResult {
  readonly environment: Environment;
  /** Blocking REGISTRY_STALE findings from reconciliation (empty when reconciled). */
  readonly registryFindings: readonly Finding[];
  /** The checklist with results recorded for this environment. */
  readonly items: readonly ChecklistItem[];
}

/** Inputs for an environment audit. */
export interface EnvironmentAuditInput {
  readonly environment: Environment;
  readonly registry: readonly ComponentEntry[];
  readonly declared: readonly DeclaredComponent[];
  readonly targets: Readonly<Record<string, string>>;
  readonly liveStackAvailable: boolean;
}

/**
 * Audit one environment. Reconciliation runs first: if the registry is stale the
 * checklist is NOT built (completeness is undefined over a stale registry) and
 * the stale findings are returned so the caller can force NOT_READY.
 */
export async function auditEnvironment(
  input: EnvironmentAuditInput,
): Promise<EnvironmentAuditResult> {
  const registryFindings = reconcileRegistry(input.registry, input.declared);
  if (registryFindings.length > 0) {
    return { environment: input.environment, registryFindings, items: [] };
  }

  const checklist = buildChecklist(input.registry);
  const ctx: ProbeContext = {
    environment: input.environment,
    targets: input.targets,
    liveStackAvailable: input.liveStackAvailable,
  };

  const items = await Promise.all(checklist.map((item) => runItem(item, input.environment, ctx)));
  return { environment: input.environment, registryFindings: [], items };
}

/** Run the applicable probe for one item in one environment and record the result. */
async function runItem(
  item: ChecklistItem,
  environment: Environment,
  ctx: ProbeContext,
): Promise<ChecklistItem> {
  const probe = item.probes[environment];
  if (probe === null) {
    // Not applicable in this environment → leave as N/A with its justification.
    return item;
  }
  const result = await probeFor(probe.probeRef.probeType)(ctx, item);
  return { ...item, results: { ...item.results, [environment]: result } };
}
