/**
 * Model-merge layer: runs the six per-source scanners, merges their
 * `DeclaredVariable`s by name (unioning provenance and validator-requiredness),
 * and classifies the result into the canonical `ConfigVariable[]`.
 *
 * This is the ONLY place the canonical model is built. The merge preserves the
 * authority chain: every catalogued variable carries at least one provenance and
 * derives its classification from the sources, never from `.env.example`.
 */

import type {
  ConfigVariable,
  DeclaredVariable,
  DiscoveryProvenance,
  Surface,
} from './inventory.model';
import { classifyVariable, type MergedVariable } from './classify';
import { scanners } from './sources';

/** Surface precedence when scanners disagree (more specific application wins). */
const SURFACE_PRECEDENCE: Record<Surface, number> = {
  MOBILE: 4,
  AI: 3,
  API: 2,
  INFRA: 1,
};

/**
 * Run all six scanners against the repo and return their combined declarations.
 *
 * @param repoRoot - Absolute repo root.
 * @returns Every declared variable across the source taxonomy.
 */
export function runAllScanners(repoRoot: string): DeclaredVariable[] {
  const declared: DeclaredVariable[] = [];
  for (const scan of Object.values(scanners)) {
    declared.push(...scan(repoRoot));
  }
  return declared;
}

/**
 * Merge declared variables by name into `MergedVariable`s.
 *
 * @param declared - Raw scanner output.
 * @returns One merged entry per distinct variable name, provenance unioned.
 */
export function mergeDeclared(declared: readonly DeclaredVariable[]): MergedVariable[] {
  const byName = new Map<string, MutableMerged>();

  for (const variable of declared) {
    const existing = byName.get(variable.name);
    if (existing === undefined) {
      byName.set(variable.name, createMutableMerged(variable));
      continue;
    }
    mergeInto(existing, variable);
  }

  return [...byName.values()].map(finalizeMerged);
}

/**
 * Build the classified canonical catalog from raw scanner output.
 *
 * @param declared - Raw scanner output.
 * @returns The classified `ConfigVariable[]`, sorted by name.
 */
export function buildCatalog(declared: readonly DeclaredVariable[]): ConfigVariable[] {
  return mergeDeclared(declared)
    .map(classifyVariable)
    .sort((left, right) => left.name.localeCompare(right.name));
}

interface MutableMerged {
  name: string;
  surface: Surface;
  group: string;
  consumedBy: Set<string>;
  requiredByValidator: boolean;
  provenance: DiscoveryProvenance[];
  sourceTypes: Set<DiscoveryProvenance['sourceType']>;
}

/** Seed a mutable merge accumulator from the first declaration of a name. */
function createMutableMerged(variable: DeclaredVariable): MutableMerged {
  return {
    name: variable.name,
    surface: variable.surface,
    group: variable.group,
    consumedBy: new Set(variable.consumedBy),
    requiredByValidator: variable.requiredByValidator,
    provenance: [variable.provenance],
    sourceTypes: new Set([variable.provenance.sourceType]),
  };
}

/** Fold a subsequent declaration of the same name into the accumulator. */
function mergeInto(target: MutableMerged, variable: DeclaredVariable): void {
  target.requiredByValidator = target.requiredByValidator || variable.requiredByValidator;
  for (const consumer of variable.consumedBy) {
    target.consumedBy.add(consumer);
  }
  target.provenance.push(variable.provenance);
  target.sourceTypes.add(variable.provenance.sourceType);
  if (SURFACE_PRECEDENCE[variable.surface] > SURFACE_PRECEDENCE[target.surface]) {
    target.surface = variable.surface;
    target.group = variable.group;
  }
}

/** Freeze a mutable accumulator into an immutable `MergedVariable`. */
function finalizeMerged(accumulator: MutableMerged): MergedVariable {
  return {
    name: accumulator.name,
    surface: accumulator.surface,
    group: accumulator.group,
    consumedBy: [...accumulator.consumedBy],
    requiredByValidator: accumulator.requiredByValidator,
    provenance: accumulator.provenance,
    sourceTypes: accumulator.sourceTypes,
  };
}
