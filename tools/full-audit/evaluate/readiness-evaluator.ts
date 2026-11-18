/**
 * Readiness evaluator — PURE aggregation over the two environments' states.
 *
 * READY iff, for every MANDATORY item: it is PASS in every environment where it
 * is APPLICABLE, every N/A is justified, there is no local-PASS/VPS-FAIL parity
 * break, carried-forward SECRET_EXPOSURE is absent, and store artifacts are
 * valid. Any violation yields a BLOCKING finding and verdict NOT_READY —
 * equivalently, READY iff no blocking finding across both environments
 * (Properties 3, 4, 5, 9).
 *
 * It MUTATES NOTHING: it reads the per-environment checklist states and returns a
 * fresh report. A probe that could not run is already recorded as FAIL (never
 * silently N/A/PASS) by the probe layer, so here N/A always means "not applicable".
 */

import type {
  ChecklistItem,
  Environment,
  Finding,
  ReadinessReport,
  Status,
} from '../checklist/checklist.model';

/** Everything the evaluator needs: both environments + store flag + carried findings. */
export interface EvaluatorInput {
  readonly local: readonly ChecklistItem[];
  readonly vps: readonly ChecklistItem[];
  readonly storeArtifactsValid: boolean;
  /** Findings carried forward (e.g. SECRET_EXPOSURE, REGISTRY_STALE) — always blocking. */
  readonly carriedFindings?: readonly Finding[];
}

/** An item paired across the two environments by invariant id. */
interface PairedItem {
  readonly invariantId: string;
  readonly local?: ChecklistItem;
  readonly vps?: ChecklistItem;
}

/**
 * Evaluate readiness across both environments. Returns the merged item set, the
 * blocking findings, and the verdict. Pure — no input is mutated.
 */
export function evaluateReadiness(input: EvaluatorInput): ReadinessReport {
  const paired = pairByInvariant(input.local, input.vps);
  const findings: Finding[] = [];

  for (const pair of paired) {
    findings.push(...evaluatePair(pair));
  }

  if (!input.storeArtifactsValid) {
    findings.push(storeFinding());
  }

  for (const carried of input.carriedFindings ?? []) {
    findings.push({ ...carried, blocking: true });
  }

  const items = mergeItems(input.local, input.vps);
  const verdict = findings.some((finding) => finding.blocking) ? 'NOT_READY' : 'READY';
  return { items, findings, verdict };
}

/** Evaluate one invariant across both environments into zero or more findings. */
function evaluatePair(pair: PairedItem): Finding[] {
  const findings: Finding[] = [];
  const reference = pair.local ?? pair.vps;
  if (reference === undefined) {
    return findings;
  }
  if (!reference.mandatory) {
    return findings; // only mandatory items gate readiness
  }

  const localStatus = statusIn(pair.local, 'local');
  const vpsStatus = statusIn(pair.vps, 'vps');

  // Tri-state integrity: an unjustified N/A on a mandatory item is itself a finding.
  findings.push(...naFindings(pair.local, 'local'));
  findings.push(...naFindings(pair.vps, 'vps'));

  // Per-environment FAIL on a mandatory+applicable item.
  if (localStatus === 'FAIL') {
    findings.push(failFinding(reference, 'local', pair.local));
  }
  if (vpsStatus === 'FAIL') {
    findings.push(failFinding(reference, 'vps', pair.vps));
  }

  // Parity: applicable in both, statuses disagree → PARITY_BREAK.
  if (isParityBreak(localStatus, vpsStatus)) {
    findings.push({
      reason: 'PARITY_BREAK',
      invariantId: pair.invariantId,
      environment: 'both',
      evidence: `parity break: local=${localStatus}, vps=${vpsStatus} on a mandatory+applicable item`,
      owner: reference.owner,
      blocking: true,
    });
  }

  return findings;
}

/** A parity break: both applicable (PASS/FAIL), and they disagree. */
function isParityBreak(local: Status | undefined, vps: Status | undefined): boolean {
  const applicable = (status: Status | undefined): status is 'PASS' | 'FAIL' =>
    status === 'PASS' || status === 'FAIL';
  if (!applicable(local) || !applicable(vps)) {
    return false;
  }
  return local !== vps;
}

/** The recorded status for an item in an environment (undefined when not applicable). */
function statusIn(item: ChecklistItem | undefined, env: Environment): Status | undefined {
  if (item === undefined) {
    return undefined;
  }
  const result = item.results[env];
  if (result === undefined) {
    // No probe + no result means the item is N/A in this environment.
    return item.probes[env] === null ? 'N/A' : undefined;
  }
  return result.status;
}

/** Findings for an unjustified N/A on a mandatory item. */
function naFindings(item: ChecklistItem | undefined, env: Environment): Finding[] {
  if (item === undefined || !item.mandatory) {
    return [];
  }
  const status = statusIn(item, env);
  if (status !== 'N/A') {
    return [];
  }
  const justification = item.applicabilityJustification[env];
  if (justification !== undefined && justification.trim() !== '') {
    return []; // justified N/A is fine
  }
  return [
    {
      reason: 'UNJUSTIFIED_NA',
      invariantId: item.invariant.id,
      environment: env,
      evidence: `mandatory item is N/A in ${env} with no applicability justification`,
      owner: item.owner,
      blocking: true,
    },
  ];
}

/** A per-environment FAIL finding, reason derived from the item's category. */
function failFinding(
  reference: ChecklistItem,
  env: Environment,
  item: ChecklistItem | undefined,
): Finding {
  const result = item?.results[env];
  return {
    reason: reasonForCategory(reference),
    invariantId: reference.invariant.id,
    environment: env,
    evidence: result?.evidence ?? `FAIL in ${env}`,
    owner: reference.owner,
    blocking: true,
  };
}

/** Map a failing item's category to its finding reason. */
function reasonForCategory(item: ChecklistItem): Finding['reason'] {
  switch (item.invariant.category) {
    case 'COMPONENT_PRESENCE':
    case 'SERVICE_HEALTH':
      return 'MISSING_OR_DOWN';
    case 'INTER_SERVICE_EDGE':
    case 'EXTERNAL_INTEGRATION':
      return 'DEAD_EDGE';
    case 'LIVE_JOURNEY':
      return 'LIVE_JOURNEY_FAILED';
    case 'STORE_READINESS':
      return 'INVALID_STORE_ARTIFACT';
    case 'DEVOPS_SECURITY':
      return 'DEVOPS_MISCONFIGURED';
  }
}

/** The blocking finding for invalid store artifacts. */
function storeFinding(): Finding {
  return {
    reason: 'INVALID_STORE_ARTIFACT',
    invariantId: 'store:artifacts',
    environment: 'both',
    evidence: 'store artifacts are not all present + valid',
    owner: 'apps/mobile',
    blocking: true,
  };
}

/** Pair items across environments by invariant id. */
function pairByInvariant(
  local: readonly ChecklistItem[],
  vps: readonly ChecklistItem[],
): PairedItem[] {
  const byId = new Map<string, PairedItem>();
  for (const item of local) {
    byId.set(item.invariant.id, { invariantId: item.invariant.id, local: item });
  }
  for (const item of vps) {
    const existing = byId.get(item.invariant.id);
    byId.set(item.invariant.id, {
      invariantId: item.invariant.id,
      local: existing?.local,
      vps: item,
    });
  }
  return [...byId.values()];
}

/**
 * Merge both environments' item lists into one item per invariant that carries
 * BOTH environments' probes, results, and justifications. The two input lists
 * each hold only their own environment's result (they come from separate
 * per-environment audit runs), so a naive last-wins merge would blank the other
 * column. This combines them so the rendered checklist shows both PASS/FAIL/N/A.
 */
function mergeItems(
  local: readonly ChecklistItem[],
  vps: readonly ChecklistItem[],
): ChecklistItem[] {
  const localById = new Map(local.map((item) => [item.invariant.id, item]));
  const vpsById = new Map(vps.map((item) => [item.invariant.id, item]));
  const ids = new Set<string>([...localById.keys(), ...vpsById.keys()]);

  const merged: ChecklistItem[] = [];
  for (const id of ids) {
    const l = localById.get(id);
    const v = vpsById.get(id);
    const reference = l ?? v;
    if (reference === undefined) {
      continue;
    }
    merged.push({
      invariant: reference.invariant,
      owner: reference.owner,
      mandatory: reference.mandatory,
      probes: {
        local: l?.probes.local ?? null,
        vps: v?.probes.vps ?? null,
      },
      results: {
        ...(l?.results.local ? { local: l.results.local } : {}),
        ...(v?.results.vps ? { vps: v.results.vps } : {}),
      },
      applicabilityJustification: {
        ...(l?.applicabilityJustification.local
          ? { local: l.applicabilityJustification.local }
          : {}),
        ...(v?.applicabilityJustification.vps
          ? { vps: v.applicabilityJustification.vps }
          : {}),
      },
    });
  }
  return merged;
}
