/**
 * Registry reconciliation — the closed registry cannot silently drift.
 *
 * The registry is authoritative, but that authority is only safe if it stays in
 * sync with its source of truth: the owning specs / ARCHITECTURE topology
 * (`DECLARED_COMPONENTS`). This PURE comparison flags every divergence as a
 * blocking REGISTRY_STALE finding:
 *   - a component declared by a spec/architecture but MISSING from the registry
 *     (an un-audited component), OR
 *   - a registry entry with NO owning declaration (a stale/removed component).
 *
 * It runs BEFORE the checklist is built, so Property 1 (completeness) is always
 * defined over a registry that is itself verified complete. A fully reconciled
 * registry yields no finding.
 */

import type { ComponentEntry } from './component-registry';
import type { DeclaredComponent } from './declared-components';
import type { Finding } from '../checklist/checklist.model';

/**
 * Compare the registry against the declared-component set and emit one blocking
 * REGISTRY_STALE finding per divergence. The result is the authoritative gate:
 * a non-empty result forces NOT_READY until reconciled.
 */
export function reconcileRegistry(
  registry: readonly ComponentEntry[],
  declared: readonly DeclaredComponent[],
): readonly Finding[] {
  const registryIds = new Set(registry.map((entry) => entry.componentId));
  const declaredById = new Map(declared.map((item) => [item.componentId, item]));

  const findings: Finding[] = [];

  // Declared but absent from the registry → an un-audited component.
  for (const item of declared) {
    if (!registryIds.has(item.componentId)) {
      findings.push(staleFinding(item.componentId, item.owner, 'declared-but-missing'));
    }
  }

  // In the registry but not declared → a stale/removed component.
  for (const entry of registry) {
    if (!declaredById.has(entry.componentId)) {
      findings.push(staleFinding(entry.componentId, entry.owner, 'registry-orphan'));
    }
  }

  return findings;
}

/** True when the registry is fully reconciled (no divergence in either direction). */
export function isRegistryReconciled(
  registry: readonly ComponentEntry[],
  declared: readonly DeclaredComponent[],
): boolean {
  return reconcileRegistry(registry, declared).length === 0;
}

/** Build a blocking REGISTRY_STALE finding routed to the owner. */
function staleFinding(
  componentId: string,
  owner: string,
  kind: 'declared-but-missing' | 'registry-orphan',
): Finding {
  const detail =
    kind === 'declared-but-missing'
      ? `'${componentId}' is declared by a spec/ARCHITECTURE but absent from the registry (un-audited component)`
      : `'${componentId}' is in the registry but has no owning spec/ARCHITECTURE declaration (stale component)`;
  return {
    reason: 'REGISTRY_STALE',
    invariantId: `registry:${componentId}`,
    environment: 'both',
    evidence: detail,
    owner,
    blocking: true,
  };
}
