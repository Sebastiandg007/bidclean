/**
 * Property 1 + unit tests for the checklist builder.
 */

import fc from 'fast-check';
import { buildChecklist } from '../checklist/checklist.builder';
import { isEventDriven, type ComponentEntry } from '../registry/component-registry';
import { registryArb } from './arbitraries';

const RUNS = { numRuns: 200 };

describe('checklist builder — property-based', () => {
  // Feature: full-audit, Property 1: For any component registry (services and internal modules
  // across all four surfaces), the checklist builder produces, for every registry entry, both a
  // component-presence checklist item and an integration checklist item, each referencing a defined
  // non-trivial probe, every item carrying an owner; no registry entry is silently absent. For any
  // event-driven entry declaring consumes/produces, its integration item's probe verifies those
  // declared events (dependency reachability alone never satisfies an event-driven entry).
  it('Property 1: registry→checklist completeness, every entry yields presence + integration items', () => {
    fc.assert(
      fc.property(registryArb, (registry) => {
        const items = buildChecklist(registry);

        for (const entry of registry) {
          const presence = items.find((item) => item.invariant.id === `presence:${entry.componentId}`);
          const integration = items.find(
            (item) => item.invariant.id === `integration:${entry.componentId}`,
          );

          // Both items exist — no silent drop.
          expect(presence).toBeDefined();
          expect(integration).toBeDefined();

          // Each carries a non-empty owner.
          expect(presence?.owner.trim().length).toBeGreaterThan(0);
          expect(integration?.owner.trim().length).toBeGreaterThan(0);

          // Each references a defined probe in at least one environment (never "assume up").
          expect(hasDefinedProbe(presence)).toBe(true);
          expect(hasDefinedProbe(integration)).toBe(true);

          // Event-driven entries: the integration invariant names the declared events.
          if (isEventDriven(entry)) {
            const declaredEvents = [
              ...(entry.consumes ?? []).map((e) => e.eventName),
              ...(entry.produces ?? []).map((e) => e.eventName),
            ];
            for (const eventName of declaredEvents) {
              expect(integration?.invariant.description).toContain(eventName);
            }
          }
        }

        // Exactly two items per entry — nothing extra, nothing missing.
        expect(items.length).toBe(registry.length * 2);
      }),
      RUNS,
    );
  });
});

function hasDefinedProbe(item: { probes: Record<string, unknown> } | undefined): boolean {
  if (item === undefined) {
    return false;
  }
  return item.probes.local !== null || item.probes.vps !== null;
}

describe('checklist builder — examples', () => {
  const base: ComponentEntry = {
    componentId: 'svc.redis',
    owner: 'infra',
    surface: 'INFRA',
    entryPoint: 'redis:6379',
    dependencies: [],
    requiredInEnvironment: 'both',
    healthProbe: { probeType: 'service-health', probeId: 'health.redis' },
    integrationProbe: { probeType: 'inter-service-edge', probeId: 'edge.redis' },
  };

  it('a fixed entry produces presence + integration items with owners and both-env probes', () => {
    const items = buildChecklist([base]);
    expect(items).toHaveLength(2);
    const presence = items.find((i) => i.invariant.category === 'COMPONENT_PRESENCE');
    expect(presence?.probes.local).not.toBeNull();
    expect(presence?.probes.vps).not.toBeNull();
    expect(presence?.owner).toBe('infra');
  });

  it('a vps-only entry is N/A (with justification) in local, never forced GREEN', () => {
    const vpsOnly: ComponentEntry = { ...base, componentId: 'svc.traefik', requiredInEnvironment: 'vps' };
    const items = buildChecklist([vpsOnly]);
    const presence = items.find((i) => i.invariant.id === 'presence:svc.traefik');
    expect(presence?.probes.local).toBeNull();
    expect(presence?.applicabilityJustification.local?.length).toBeGreaterThan(0);
    expect(presence?.probes.vps).not.toBeNull();
  });

  it('an event-driven entry gets an integration item naming its declared events', () => {
    const eventDriven: ComponentEntry = {
      ...base,
      componentId: 'api.worker.tier-delivery',
      consumes: [{ eventName: 'deliver-to-tier' }],
      produces: [{ eventName: 'offer.matched' }],
    };
    const items = buildChecklist([eventDriven]);
    const integration = items.find((i) => i.invariant.id === 'integration:api.worker.tier-delivery');
    expect(integration?.invariant.description).toContain('offer.matched');
    expect(integration?.invariant.description).toContain('deliver-to-tier');
  });
});
