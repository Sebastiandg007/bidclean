/**
 * Shared fast-check arbitraries for the full-audit property-based suites.
 *
 * Generates arbitrary component registries (varied surfaces, entries with/without
 * native health endpoints, event-driven entries with arbitrary consumes/produces),
 * arbitrary checklists with independently-chosen per-environment tri-state
 * statuses / mandatory flags / justified-or-not N/A / applicable-or-not items,
 * arbitrary probe-result sets, synthetic evidence strings with/without
 * secret-shaped substrings, and registry-vs-declared pairs — so edge cases come
 * from generation, not hand-written examples.
 */

import fc from 'fast-check';
import type {
  ComponentEntry,
  EventRef,
  ProbeRef,
  ProbeType,
  RequiredInEnvironment,
  Surface,
} from '../registry/component-registry';
import type { DeclaredComponent } from '../registry/declared-components';
import type {
  CheckCategory,
  ChecklistItem,
  Environment,
  Invariant,
  Probe,
  ProbeResult,
  Status,
} from '../checklist/checklist.model';

const SURFACES: readonly Surface[] = ['API', 'AI', 'MOBILE', 'INFRA'];
const REQUIRED_ENVS: readonly RequiredInEnvironment[] = ['local', 'vps', 'both'];
const PROBE_TYPES: readonly ProbeType[] = [
  'component-presence',
  'service-health',
  'inter-service-edge',
  'external-integration',
  'live-journey',
  'store-readiness',
  'devops-security',
];
const CATEGORIES: readonly CheckCategory[] = [
  'COMPONENT_PRESENCE',
  'SERVICE_HEALTH',
  'INTER_SERVICE_EDGE',
  'EXTERNAL_INTEGRATION',
  'LIVE_JOURNEY',
  'STORE_READINESS',
  'DEVOPS_SECURITY',
];
const EVENT_NAMES = [
  'offer.matched',
  'service_arrived',
  'checklist_completed',
  'service_disputed',
  'delivery-intent',
] as const;

/** A stable component id shape. */
export const componentIdArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('svc', 'api', 'ai', 'ext', 'mobile'),
    fc.integer({ min: 0, max: 9999 }),
  )
  .map(([prefix, n]) => `${prefix}.c${n}`);

/** An owner label (always non-empty). */
export const ownerArb: fc.Arbitrary<string> = fc.constantFrom(
  'services/api',
  'stripe-escrow',
  'offer-radar',
  'push-notifications',
  'infra',
);

export const surfaceArb: fc.Arbitrary<Surface> = fc.constantFrom(...SURFACES);
export const probeTypeArb: fc.Arbitrary<ProbeType> = fc.constantFrom(...PROBE_TYPES);
export const categoryArb: fc.Arbitrary<CheckCategory> = fc.constantFrom(...CATEGORIES);
export const statusArb: fc.Arbitrary<Status> = fc.constantFrom('PASS', 'FAIL', 'N/A');

export const probeRefArb: fc.Arbitrary<ProbeRef> = fc.record({
  probeType: probeTypeArb,
  probeId: fc.constantFrom('p.a', 'p.b', 'p.c'),
});

export const eventRefArb: fc.Arbitrary<EventRef> = fc.record({
  eventName: fc.constantFrom(...EVENT_NAMES),
});

/** A component entry, optionally event-driven (consumes/produces present). */
export const componentEntryArb: fc.Arbitrary<ComponentEntry> = fc
  .record({
    componentId: componentIdArb,
    owner: ownerArb,
    surface: surfaceArb,
    entryPoint: fc.constantFrom('route /x', 'queue q', 'consumer c', 'cron', 'container'),
    dependencies: fc.array(componentIdArb, { maxLength: 3 }),
    requiredInEnvironment: fc.constantFrom(...REQUIRED_ENVS),
    healthProbe: probeRefArb,
    integrationProbe: probeRefArb,
    consumes: fc.option(fc.array(eventRefArb, { minLength: 1, maxLength: 3 }), { nil: undefined }),
    produces: fc.option(fc.array(eventRefArb, { minLength: 1, maxLength: 3 }), { nil: undefined }),
  })
  .map((entry) => {
    // Strip undefined optional fields so the shape matches exactOptional expectations.
    const base: ComponentEntry = {
      componentId: entry.componentId,
      owner: entry.owner,
      surface: entry.surface,
      entryPoint: entry.entryPoint,
      dependencies: entry.dependencies,
      requiredInEnvironment: entry.requiredInEnvironment,
      healthProbe: entry.healthProbe,
      integrationProbe: entry.integrationProbe,
    };
    return {
      ...base,
      ...(entry.consumes ? { consumes: entry.consumes } : {}),
      ...(entry.produces ? { produces: entry.produces } : {}),
    };
  });

/** A registry with unique componentIds (duplicates would be a loader error, not a logic input). */
export const registryArb: fc.Arbitrary<ComponentEntry[]> = fc
  .array(componentEntryArb, { maxLength: 12 })
  .map((entries) => {
    const seen = new Set<string>();
    return entries.filter((entry) => {
      if (seen.has(entry.componentId)) {
        return false;
      }
      seen.add(entry.componentId);
      return true;
    });
  });

/**
 * A declared-component set with UNIQUE componentIds (the real declared set and
 * registry both key by a unique componentId; duplicates are not a valid input).
 */
export const declaredArb: fc.Arbitrary<DeclaredComponent[]> = fc
  .array(fc.record({ componentId: componentIdArb, owner: ownerArb }), { maxLength: 12 })
  .map((items) => {
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.componentId)) {
        return false;
      }
      seen.add(item.componentId);
      return true;
    });
  });

const invariantArb: fc.Arbitrary<Invariant> = fc.record({
  id: fc.constantFrom('inv.a', 'inv.b', 'inv.c', 'inv.d'),
  description: fc.constantFrom('API→Keycloak JWKS', 'service up', 'journey A'),
  category: categoryArb,
});

const probeResultArb: fc.Arbitrary<ProbeResult> = fc.record({
  status: statusArb,
  evidence: fc.constantFrom('authenticated', 'JWKS valid', 'DEAD_EDGE', 'healthy'),
  observedAt: fc.constant('2024-06-01T00:00:00.000Z'),
});

/**
 * A checklist item with independently-chosen per-environment status, mandatory
 * flag, justified-or-not N/A, and applicable-or-not probes. The `probes`/`results`
 * are kept consistent (a null probe ⇒ no result ⇒ N/A in that env).
 */
export const checklistItemArb: fc.Arbitrary<ChecklistItem> = fc
  .record({
    invariant: invariantArb,
    owner: ownerArb,
    mandatory: fc.boolean(),
    localApplicable: fc.boolean(),
    vpsApplicable: fc.boolean(),
    localResult: fc.option(probeResultArb, { nil: undefined }),
    vpsResult: fc.option(probeResultArb, { nil: undefined }),
    justifyLocal: fc.boolean(),
    justifyVps: fc.boolean(),
  })
  .map((raw) => buildItem(raw));

/** Build a self-consistent ChecklistItem from raw generated choices. */
function buildItem(raw: {
  invariant: Invariant;
  owner: string;
  mandatory: boolean;
  localApplicable: boolean;
  vpsApplicable: boolean;
  localResult?: ProbeResult;
  vpsResult?: ProbeResult;
  justifyLocal: boolean;
  justifyVps: boolean;
}): ChecklistItem {
  const probes: Record<Environment, Probe | null> = {
    local: raw.localApplicable ? probeFor(raw.invariant, 'local') : null,
    vps: raw.vpsApplicable ? probeFor(raw.invariant, 'vps') : null,
  };
  const results: Partial<Record<Environment, ProbeResult>> = {};
  if (raw.localApplicable && raw.localResult) {
    results.local = raw.localResult;
  }
  if (raw.vpsApplicable && raw.vpsResult) {
    results.vps = raw.vpsResult;
  }
  const applicabilityJustification: Partial<Record<Environment, string>> = {};
  if (!raw.localApplicable && raw.justifyLocal) {
    applicabilityJustification.local = 'not applicable in local';
  }
  if (!raw.vpsApplicable && raw.justifyVps) {
    applicabilityJustification.vps = 'not applicable in vps';
  }
  return {
    invariant: raw.invariant,
    owner: raw.owner,
    mandatory: raw.mandatory,
    probes,
    results,
    applicabilityJustification,
  };
}

function probeFor(invariant: Invariant, environment: Environment): Probe {
  return {
    probeRef: { probeType: 'component-presence', probeId: `p.${invariant.id}` },
    environment,
    target: `${environment}:x`,
  };
}

/**
 * A list of checklist items with UNIQUE invariant ids (as a real builder always
 * produces). Uniqueness matters because the evaluator pairs/merges items by
 * invariant id; duplicate ids would be an invalid checklist, not a logic input.
 */
export const checklistArb: fc.Arbitrary<ChecklistItem[]> = fc
  .array(checklistItemArb, { maxLength: 10 })
  .map((items) =>
    items.map((item, index) => ({
      ...item,
      invariant: { ...item.invariant, id: `inv.${index}` },
    })),
  );
