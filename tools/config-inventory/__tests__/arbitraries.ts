/**
 * fast-check arbitraries shared by the property-based tests. They generate
 * arbitrary declared variables (across the full source taxonomy), env-example
 * entry sets, mis-prefixed secrets, and synthetic secret-bearing file lists, so
 * edge cases are covered by generation rather than hand-written examples.
 */

import fc from 'fast-check';
import type {
  DeclaredVariable,
  DiscoveryProvenance,
  RequiredScope,
  SourceType,
  Surface,
} from '../inventory.model';
import type { EnvExampleEntry } from '../sources/env-example-parser';

const SOURCE_TYPES: readonly SourceType[] = [
  'APPLICATION',
  'BUILD',
  'DEPLOY',
  'INFRA',
  'CI',
  'RUNTIME',
];
const SURFACES: readonly Surface[] = ['API', 'AI', 'MOBILE', 'INFRA'];
const SCOPES: readonly RequiredScope[] = ['runtime', 'build', 'deploy', 'infra'];
const ENVS = ['local', 'staging', 'production'] as const;

/** An UPPER_SNAKE env-var name (always a valid identifier shape). */
export const envNameArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('A', 'B', 'C', 'D', 'E', 'X', 'Y', 'Z'),
    fc.array(fc.constantFrom('A', 'B', 'C', 'D', 'E', 'F', 'G', '0', '1', '2', '_'), {
      minLength: 2,
      maxLength: 12,
    }),
  )
  .map(([head, rest]) => (head + rest.join('')).replace(/_+$/, '').replace(/_{2,}/g, '_'))
  .filter((name) => /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(name));

/** A source type. */
export const sourceTypeArb: fc.Arbitrary<SourceType> = fc.constantFrom(...SOURCE_TYPES);

/** A surface. */
export const surfaceArb: fc.Arbitrary<Surface> = fc.constantFrom(...SURFACES);

/** A discovery provenance record. */
export const provenanceArb: fc.Arbitrary<DiscoveryProvenance> = fc.record({
  sourceType: sourceTypeArb,
  sourceFile: fc.constantFrom('a/b.ts', 'c/d.yml', 'e/f.py', 'g/h.json'),
  sourceLocation: fc.constantFrom('L1', 'L42', 'build.prod.env', 'jobs.ci.env'),
});

/** A declared variable emitted by a single scanner. */
export const declaredVariableArb: fc.Arbitrary<DeclaredVariable> = fc.record({
  name: envNameArb,
  surface: surfaceArb,
  group: fc.constantFrom('payments', 'chat', 'infra', 'mobile', 'ai', 'ci'),
  consumedBy: fc.array(fc.constantFrom('x.ts', 'y.ts', 'z.py'), { minLength: 1, maxLength: 3 }),
  requiredByValidator: fc.boolean(),
  provenance: provenanceArb,
});

/** A list of declared variables (may contain duplicate names). */
export const declaredListArb: fc.Arbitrary<DeclaredVariable[]> = fc.array(declaredVariableArb, {
  maxLength: 25,
});

/** An `.env.example` entry. */
export const envEntryArb: fc.Arbitrary<EnvExampleEntry> = fc.record({
  name: envNameArb,
  section: fc.constantFrom('Payments', 'Chat', 'Infra', 'Mobile'),
  placeholder: fc.constantFrom('CHANGE_ME', 'value-here', '3000', ''),
  comment: fc.option(fc.constantFrom('required', 'optional', 'purpose note'), { nil: undefined }),
});

/** A list of `.env.example` entries. */
export const envEntryListArb: fc.Arbitrary<EnvExampleEntry[]> = fc.array(envEntryArb, {
  maxLength: 25,
});

/** An independently-chosen requiredScope tuple (drawn only from scope tokens). */
export const requiredScopeArb: fc.Arbitrary<readonly RequiredScope[]> = fc.uniqueArray(
  fc.constantFrom(...SCOPES),
  { minLength: 1, maxLength: 4 },
);

/** An independently-chosen envApplicability tuple (drawn only from env tokens). */
export const envApplicabilityArb: fc.Arbitrary<ReadonlyArray<(typeof ENVS)[number]>> =
  fc.uniqueArray(fc.constantFrom(...ENVS), { minLength: 1, maxLength: 3 });
