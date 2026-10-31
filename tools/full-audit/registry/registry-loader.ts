/**
 * Registry loader — parses `component-registry.yaml` into `ComponentEntry[]`.
 *
 * Fails LOUDLY on any malformed entry (never returns a partial/silent registry):
 * a registry that silently drops an entry would silently drop that component from
 * the audit, which is exactly the hole the closed registry exists to prevent.
 */

import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import type {
  ComponentEntry,
  EventRef,
  ProbeRef,
  ProbeType,
  RequiredInEnvironment,
  Surface,
} from './component-registry';

/** Raised when the registry YAML is malformed. Carries the offending context. */
export class RegistryParseError extends Error {
  constructor(message: string) {
    super(`component-registry.yaml is malformed: ${message}`);
    this.name = 'RegistryParseError';
  }
}

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

/** The YAML top-level shape: `{ version, components: [...] }`. */
interface RegistryFile {
  readonly version?: unknown;
  readonly components?: unknown;
}

/** Parse the registry file at `absolutePath` into typed entries. */
export function loadRegistryFile(absolutePath: string): ComponentEntry[] {
  const raw = readFileSync(absolutePath, 'utf8');
  return parseRegistry(raw);
}

/** Parse a registry YAML string into typed entries (fails loudly on any error). */
export function parseRegistry(yaml: string): ComponentEntry[] {
  const doc = load(yaml) as RegistryFile | undefined;
  if (doc === undefined || doc === null || typeof doc !== 'object') {
    throw new RegistryParseError('top-level document is not a mapping');
  }
  if (!Array.isArray(doc.components)) {
    throw new RegistryParseError('`components` must be a list');
  }
  const entries = doc.components.map((entry, index) => parseEntry(entry, index));
  assertUniqueIds(entries);
  return entries;
}

/** Parse + validate a single component entry. */
function parseEntry(value: unknown, index: number): ComponentEntry {
  if (typeof value !== 'object' || value === null) {
    throw new RegistryParseError(`component[${index}] is not a mapping`);
  }
  const raw = value as Record<string, unknown>;
  const where = `component[${index}] '${String(raw.componentId ?? '?')}'`;

  return {
    componentId: requireString(raw.componentId, `${where}.componentId`),
    owner: requireString(raw.owner, `${where}.owner`),
    surface: requireEnum(raw.surface, SURFACES, `${where}.surface`),
    entryPoint: requireString(raw.entryPoint, `${where}.entryPoint`),
    dependencies: requireStringArray(raw.dependencies, `${where}.dependencies`),
    requiredInEnvironment: requireEnum(
      raw.requiredInEnvironment,
      REQUIRED_ENVS,
      `${where}.requiredInEnvironment`,
    ),
    healthProbe: parseProbeRef(raw.healthProbe, `${where}.healthProbe`),
    integrationProbe: parseProbeRef(raw.integrationProbe, `${where}.integrationProbe`),
    ...optionalEvents('consumes', raw.consumes, where),
    ...optionalEvents('produces', raw.produces, where),
  };
}

/** Parse a `ProbeRef` (`{ probeType, probeId }`). */
function parseProbeRef(value: unknown, where: string): ProbeRef {
  if (typeof value !== 'object' || value === null) {
    throw new RegistryParseError(`${where} must be a { probeType, probeId } mapping`);
  }
  const raw = value as Record<string, unknown>;
  return {
    probeType: requireEnum(raw.probeType, PROBE_TYPES, `${where}.probeType`),
    probeId: requireString(raw.probeId, `${where}.probeId`),
  };
}

/** Parse an optional `consumes`/`produces` list into a partial entry fragment. */
function optionalEvents(
  field: 'consumes' | 'produces',
  value: unknown,
  where: string,
): Partial<Pick<ComponentEntry, 'consumes' | 'produces'>> {
  if (value === undefined || value === null) {
    return {};
  }
  if (!Array.isArray(value)) {
    throw new RegistryParseError(`${where}.${field} must be a list when present`);
  }
  const events = value.map((event, index) => parseEvent(event, `${where}.${field}[${index}]`));
  return { [field]: events };
}

/** Parse a single `EventRef` (`{ eventName, channel? }`). */
function parseEvent(value: unknown, where: string): EventRef {
  if (typeof value !== 'object' || value === null) {
    throw new RegistryParseError(`${where} must be a { eventName, channel? } mapping`);
  }
  const raw = value as Record<string, unknown>;
  const eventName = requireString(raw.eventName, `${where}.eventName`);
  if (raw.channel === undefined || raw.channel === null) {
    return { eventName };
  }
  return { eventName, channel: requireString(raw.channel, `${where}.channel`) };
}

/** Enforce stable, unique componentIds (a duplicate id would mask a component). */
function assertUniqueIds(entries: readonly ComponentEntry[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.componentId)) {
      throw new RegistryParseError(`duplicate componentId '${entry.componentId}'`);
    }
    seen.add(entry.componentId);
  }
}

function requireString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RegistryParseError(`${where} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(value: unknown, where: string): readonly string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new RegistryParseError(`${where} must be a list of strings`);
  }
  return value as string[];
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], where: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new RegistryParseError(`${where} must be one of ${allowed.join(' | ')}`);
  }
  return value as T;
}
