/**
 * Checklist builder — derives the checklist from the reconciled registry.
 *
 * For EVERY registry entry it produces BOTH a component-presence item AND an
 * integration item, each referencing a defined, non-trivial probe (an entry with
 * no native health endpoint still gets a minimal liveness probe — never "assume
 * up"); every item carries an owner (Property 1). For an event-driven entry the
 * integration item's probe targets the DECLARED events firing (not just
 * dependency reachability). It runs ONLY after reconciliation passes, so
 * completeness is guaranteed over a verified-complete registry.
 *
 * Items whose invariant is meaningful only in one environment (real certs, prod
 * domains, VPS routing) are N/A in the other WITH a justification — never forced
 * GREEN, never silently skipped.
 */

import type { ComponentEntry, ProbeRef, ProbeType } from '../registry/component-registry';
import { isEventDriven } from '../registry/component-registry';
import type {
  CheckCategory,
  ChecklistItem,
  Environment,
  Invariant,
  Probe,
} from './checklist.model';

/** Map a registry probe type to the matching checklist category. */
const PROBE_TYPE_TO_CATEGORY: Readonly<Record<ProbeType, CheckCategory>> = {
  'component-presence': 'COMPONENT_PRESENCE',
  'service-health': 'SERVICE_HEALTH',
  'inter-service-edge': 'INTER_SERVICE_EDGE',
  'external-integration': 'EXTERNAL_INTEGRATION',
  'live-journey': 'LIVE_JOURNEY',
  'store-readiness': 'STORE_READINESS',
  'devops-security': 'DEVOPS_SECURITY',
};

/** The environments an item is applicable in, derived from `requiredInEnvironment`. */
function applicableEnvironments(entry: ComponentEntry): readonly Environment[] {
  if (entry.requiredInEnvironment === 'both') {
    return ['local', 'vps'];
  }
  return [entry.requiredInEnvironment];
}

/** Build the per-environment probe map + N/A justifications for an item. */
function buildProbeMap(
  probeRef: ProbeRef,
  target: string,
  applicable: readonly Environment[],
): Pick<ChecklistItem, 'probes' | 'applicabilityJustification'> {
  const probes: Record<Environment, Probe | null> = { local: null, vps: null };
  const applicabilityJustification: Partial<Record<Environment, string>> = {};

  for (const env of ['local', 'vps'] as const) {
    if (applicable.includes(env)) {
      probes[env] = { probeRef, environment: env, target: targetFor(target, env) };
    } else {
      applicabilityJustification[env] =
        `not applicable in ${env}: component is required only in ${applicable.join('/')}`;
    }
  }
  return { probes, applicabilityJustification };
}

/** Resolve an env-appropriate target label (localhost vs public subdomain, etc.). */
function targetFor(baseTarget: string, env: Environment): string {
  return env === 'local' ? `local:${baseTarget}` : `vps:${baseTarget}`;
}

/** Build the component-presence item for an entry (liveness, never "assume up"). */
function presenceItem(entry: ComponentEntry): ChecklistItem {
  const invariant: Invariant = {
    id: `presence:${entry.componentId}`,
    description: `${entry.componentId} is present + up (${entry.entryPoint})`,
    category: 'COMPONENT_PRESENCE',
  };
  const applicable = applicableEnvironments(entry);
  return {
    invariant,
    owner: entry.owner,
    mandatory: true,
    results: {},
    ...buildProbeMap(entry.healthProbe, entry.entryPoint, applicable),
  };
}

/** Build the integration item for an entry (edge/consumer/emitter wired-in proof). */
function integrationItem(entry: ComponentEntry): ChecklistItem {
  const category = PROBE_TYPE_TO_CATEGORY[entry.integrationProbe.probeType];
  const invariant: Invariant = {
    id: `integration:${entry.componentId}`,
    description: integrationDescription(entry),
    category,
  };
  const applicable = applicableEnvironments(entry);
  return {
    invariant,
    owner: entry.owner,
    mandatory: true,
    results: {},
    ...buildProbeMap(entry.integrationProbe, entry.entryPoint, applicable),
  };
}

/** The integration invariant text — event-driven entries name their declared events. */
function integrationDescription(entry: ComponentEntry): string {
  if (isEventDriven(entry)) {
    const events = [
      ...(entry.consumes ?? []).map((event) => `consumes ${event.eventName}`),
      ...(entry.produces ?? []).map((event) => `produces ${event.eventName}`),
    ];
    return `${entry.componentId} is wired: ${events.join(', ')} fire end-to-end`;
  }
  return `${entry.componentId} is wired into the running system (edge reachable + authenticated)`;
}

/**
 * Build the full checklist from a RECONCILED registry. Produces exactly two items
 * per entry (presence + integration); no entry is ever silently absent.
 */
export function buildChecklist(registry: readonly ComponentEntry[]): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  for (const entry of registry) {
    items.push(presenceItem(entry));
    items.push(integrationItem(entry));
  }
  return items;
}
