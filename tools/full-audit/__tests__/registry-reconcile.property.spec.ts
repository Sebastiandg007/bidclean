/**
 * Property 11 + unit tests for registry reconciliation.
 */

import fc from 'fast-check';
import { reconcileRegistry } from '../registry/registry-reconcile';
import { registryArb, declaredArb } from './arbitraries';
import type { ComponentEntry } from '../registry/component-registry';
import type { DeclaredComponent } from '../registry/declared-components';

const RUNS = { numRuns: 200 };

describe('registry reconciliation — property-based', () => {
  // Feature: full-audit, Property 11: For any divergence between the component registry and the
  // components declared by the owning specs / ARCHITECTURE topology — a component declared but
  // absent from the registry, or a registry entry with no owning declaration — the audit emits a
  // blocking REGISTRY_STALE finding and the verdict is NOT_READY; and for any fully reconciled
  // registry (every declared component present, no orphan entries) no REGISTRY_STALE finding is
  // emitted.
  it('Property 11: registry reconciliation detects drift in both directions, none when reconciled', () => {
    fc.assert(
      fc.property(registryArb, declaredArb, (registry, declared) => {
        const findings = reconcileRegistry(registry, declared);
        const registryIds = new Set(registry.map((entry) => entry.componentId));
        const declaredIds = new Set(declared.map((item) => item.componentId));

        // Every divergence is reported exactly, and every finding is blocking REGISTRY_STALE.
        const missingDeclared = [...declaredIds].filter((id) => !registryIds.has(id));
        const orphanRegistry = [...registryIds].filter((id) => !declaredIds.has(id));
        const expectedCount = missingDeclared.length + orphanRegistry.length;

        expect(findings.length).toBe(expectedCount);
        for (const finding of findings) {
          expect(finding.reason).toBe('REGISTRY_STALE');
          expect(finding.blocking).toBe(true);
          expect(finding.owner.trim().length).toBeGreaterThan(0);
        }

        // A fully reconciled registry yields no finding.
        if (expectedCount === 0) {
          expect(findings).toHaveLength(0);
        }
      }),
      RUNS,
    );
  });
});

describe('registry reconciliation — examples', () => {
  const entry = (componentId: string, owner: string): ComponentEntry => ({
    componentId,
    owner,
    surface: 'API',
    entryPoint: 'route /x',
    dependencies: [],
    requiredInEnvironment: 'both',
    healthProbe: { probeType: 'service-health', probeId: 'h' },
    integrationProbe: { probeType: 'inter-service-edge', probeId: 'i' },
  });
  const declared = (componentId: string, owner: string): DeclaredComponent => ({
    componentId,
    owner,
  });

  it('matching set yields no finding', () => {
    const findings = reconcileRegistry(
      [entry('a', 'team-a')],
      [declared('a', 'team-a')],
    );
    expect(findings).toHaveLength(0);
  });

  it('a declared component absent from the registry is a blocking REGISTRY_STALE routed to owner', () => {
    const findings = reconcileRegistry([], [declared('a', 'team-a')]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      reason: 'REGISTRY_STALE',
      owner: 'team-a',
      blocking: true,
    });
  });

  it('an orphan registry entry (no owning declaration) is a blocking REGISTRY_STALE', () => {
    const findings = reconcileRegistry([entry('a', 'team-a')], []);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ reason: 'REGISTRY_STALE', blocking: true });
  });
});
