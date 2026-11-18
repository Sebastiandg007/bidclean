/**
 * Unit tests for the registry YAML loader (Task 2.3): a well-formed document
 * parses into ComponentEntry[] with events preserved; any malformed entry fails
 * loudly (never a partial/silent registry). Also smoke-loads the real artifact.
 */

import { join } from 'node:path';
import { parseRegistry, loadRegistryFile, RegistryParseError } from '../registry/registry-loader';

const WELL_FORMED = `
version: 1
components:
  - componentId: svc.api
    owner: services/api
    surface: API
    entryPoint: NestJS HTTP
    dependencies: [svc.postgres]
    requiredInEnvironment: both
    healthProbe: { probeType: service-health, probeId: health.api }
    integrationProbe: { probeType: component-presence, probeId: presence.api }
  - componentId: api.worker.tier-delivery
    owner: offer-radar
    surface: API
    entryPoint: queue offer-tier-delivery
    dependencies: [svc.redis]
    consumes: [{ eventName: deliver-to-tier, channel: offer-tier-delivery }]
    produces: [{ eventName: offer.matched, channel: offer_outbox }]
    requiredInEnvironment: both
    healthProbe: { probeType: component-presence, probeId: presence.worker }
    integrationProbe: { probeType: inter-service-edge, probeId: edge.redis }
`;

describe('registry loader', () => {
  it('parses a well-formed registry into ComponentEntry[] with events preserved', () => {
    const entries = parseRegistry(WELL_FORMED);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.componentId).toBe('svc.api');
    const worker = entries[1];
    expect(worker?.consumes?.[0]?.eventName).toBe('deliver-to-tier');
    expect(worker?.produces?.[0]?.eventName).toBe('offer.matched');
    expect(worker?.produces?.[0]?.channel).toBe('offer_outbox');
  });

  it('fails loudly when `components` is not a list', () => {
    expect(() => parseRegistry('version: 1\ncomponents: nope')).toThrow(RegistryParseError);
  });

  it('fails loudly on a missing required field (never a partial registry)', () => {
    const malformed = `
version: 1
components:
  - componentId: svc.api
    owner: services/api
    surface: API
`;
    expect(() => parseRegistry(malformed)).toThrow(RegistryParseError);
  });

  it('fails loudly on an invalid enum value', () => {
    const malformed = `
version: 1
components:
  - componentId: svc.api
    owner: services/api
    surface: NOT_A_SURFACE
    entryPoint: x
    requiredInEnvironment: both
    healthProbe: { probeType: service-health, probeId: h }
    integrationProbe: { probeType: inter-service-edge, probeId: i }
`;
    expect(() => parseRegistry(malformed)).toThrow(/surface/);
  });

  it('fails loudly on duplicate componentIds', () => {
    const dup = WELL_FORMED + WELL_FORMED.split('\n').slice(2).join('\n');
    expect(() => parseRegistry(dup)).toThrow(/duplicate/);
  });

  it('loads the real component-registry.yaml artifact without error', () => {
    const path = join(
      process.cwd(),
      'tools',
      'full-audit',
      'registry',
      'component-registry.yaml',
    );
    const entries = loadRegistryFile(path);
    expect(entries.length).toBeGreaterThanOrEqual(40);
    // Spot-check a known real event-driven component.
    const relay = entries.find((e) => e.componentId === 'api.relay.notifications-outbox');
    expect(relay?.consumes?.some((e) => e.eventName === 'offer.matched')).toBe(true);
  });
});
