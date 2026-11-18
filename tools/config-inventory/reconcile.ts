/**
 * Reconciliation engine — the heart of the authority chain.
 *
 * Direction is fixed: the config sources (via the canonical model) win on
 * existence; `.env.example` is a shape projection and MAY NOT declare a variable
 * no source recognizes. The diff is pure set arithmetic over names:
 *   - missing  = declared names not present in `.env.example`
 *   - orphaned = `.env.example` names with no declaring source
 *   - required mismatch = validator-required-ness vs how the entry is documented
 */

import type { DeclaredVariable, Finding } from './inventory.model';
import type { EnvExampleEntry } from './sources/env-example-parser';

/** Result of reconciling declared variables against `.env.example` entries. */
export interface ReconcileResult {
  missingInEnvExample: DeclaredVariable[]; // a source reads it, not in .env.example → add
  orphanedInEnvExample: EnvExampleEntry[]; // in .env.example, no source reads it → flag
  requiredMismatches: Array<{
    name: string;
    declaredRequired: boolean;
    documentedRequired: boolean;
  }>;
}

/**
 * Compute the reconciliation diff between declared variables and env entries.
 *
 * @param declared - Variables discovered across the source taxonomy.
 * @param envExample - Entries parsed from `.env.example`.
 * @returns The missing / orphaned / required-mismatch diff.
 */
export function reconcile(
  declared: DeclaredVariable[],
  envExample: EnvExampleEntry[],
): ReconcileResult {
  const declaredByName = indexDeclaredByName(declared);
  const envNames = new Set(envExample.map((entry) => entry.name));

  const missingInEnvExample = dedupeDeclaredByName(declared).filter(
    (variable) => !envNames.has(variable.name),
  );

  const orphanedInEnvExample = envExample.filter((entry) => !declaredByName.has(entry.name));

  const requiredMismatches = computeRequiredMismatches(declaredByName, envExample);

  return { missingInEnvExample, orphanedInEnvExample, requiredMismatches };
}

/**
 * Convert a reconciliation result into machine-checkable findings. Orphans that
 * carry a valid structured justification (supplied via `justifiedOrphanNames`)
 * are excluded from the orphan findings.
 *
 * @param result - The reconciliation diff.
 * @param justifiedOrphanNames - Names allowed to remain as orphans.
 * @returns Reconciliation findings (non-blocking by themselves).
 */
export function reconciliationFindings(
  result: ReconcileResult,
  justifiedOrphanNames: ReadonlySet<string> = new Set(),
): Finding[] {
  const findings: Finding[] = [];

  for (const variable of result.missingInEnvExample) {
    findings.push({
      code: 'MISSING_IN_ENV_EXAMPLE',
      variable: variable.name,
      detail: `'${variable.name}' is read by a source but absent from .env.example`,
      blocking: false,
    });
  }

  for (const entry of result.orphanedInEnvExample) {
    if (justifiedOrphanNames.has(entry.name)) {
      continue;
    }
    findings.push({
      code: 'ORPHANED_ENV_EXAMPLE',
      variable: entry.name,
      detail: `'${entry.name}' is declared in .env.example but no source reads it`,
      blocking: false,
    });
  }

  for (const mismatch of result.requiredMismatches) {
    findings.push({
      code: 'REQUIRED_MISMATCH',
      variable: mismatch.name,
      detail:
        `'${mismatch.name}' validator-required=${mismatch.declaredRequired} ` +
        `but documented-required=${mismatch.documentedRequired}`,
      blocking: false,
    });
  }

  return findings;
}

/** Index declared variables by name, unioning validator-requiredness. */
function indexDeclaredByName(declared: DeclaredVariable[]): Map<string, boolean> {
  const requiredByName = new Map<string, boolean>();
  for (const variable of declared) {
    const previous = requiredByName.get(variable.name) ?? false;
    requiredByName.set(variable.name, previous || variable.requiredByValidator);
  }
  return requiredByName;
}

/** Return one representative declared variable per distinct name (first wins). */
function dedupeDeclaredByName(declared: DeclaredVariable[]): DeclaredVariable[] {
  const seen = new Set<string>();
  const unique: DeclaredVariable[] = [];
  for (const variable of declared) {
    if (!seen.has(variable.name)) {
      seen.add(variable.name);
      unique.push(variable);
    }
  }
  return unique;
}

/**
 * Compute required-vs-documented mismatches. A `.env.example` entry is treated
 * as documented-required when its comment marks it required (`REQUIRED`) and not
 * optional; the declared side is validator-requiredness. Only names present on
 * both sides are compared.
 */
function computeRequiredMismatches(
  declaredByName: Map<string, boolean>,
  envExample: EnvExampleEntry[],
): ReconcileResult['requiredMismatches'] {
  const mismatches: ReconcileResult['requiredMismatches'] = [];
  for (const entry of envExample) {
    const declaredRequired = declaredByName.get(entry.name);
    if (declaredRequired === undefined) {
      continue; // orphan; handled separately
    }
    const documentedRequired = isDocumentedRequired(entry);
    if (declaredRequired !== documentedRequired) {
      mismatches.push({ name: entry.name, declaredRequired, documentedRequired });
    }
  }
  return mismatches;
}

/** True when an entry's comment documents it as required (and not optional). */
function isDocumentedRequired(entry: EnvExampleEntry): boolean {
  const comment = (entry.comment ?? '').toUpperCase();
  if (comment.includes('OPTIONAL')) {
    return false;
  }
  return comment.includes('REQUIRED');
}
