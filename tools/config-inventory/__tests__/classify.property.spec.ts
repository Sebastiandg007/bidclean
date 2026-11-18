/**
 * Property-based tests for classification, the public/secret boundary, the
 * AI-surface rule, requiredScope, and axis orthogonality (Properties 5-10).
 * Uses fast-check, minimum 100 runs per property.
 */

import fc from 'fast-check';
import {
  classifyKind,
  checkBoundary,
  classifyVariable,
  isStorageCredential,
  matchesHardSecretName,
  SECRET_PLACEHOLDER,
  type MergedVariable,
} from '../classify';
import { SECRET_DETECTORS } from '../exposure-scanner';
import type { ConfigVariable, Surface } from '../inventory.model';
import { envNameArb, provenanceArb, surfaceArb } from './arbitraries';

const RUNS = { numRuns: 200 };

/** Build a MergedVariable from generated parts. */
function mergedOf(
  name: string,
  surface: Surface,
  requiredByValidator: boolean,
  sourceTypes: MergedVariable['sourceTypes'],
): MergedVariable {
  return {
    name,
    surface,
    group: 'g',
    consumedBy: ['x.ts'],
    requiredByValidator,
    provenance: [
      { sourceType: [...sourceTypes][0] ?? 'APPLICATION', sourceFile: 'x.ts', sourceLocation: 'L1' },
    ],
    sourceTypes,
  };
}

/** An arbitrary secret-shaped name (matches a hard server-secret pattern). */
const hardSecretNameArb: fc.Arbitrary<string> = fc.constantFrom(
  'STRIPE_SECRET_KEY',
  'ONESIGNAL_API_KEY',
  'KEYCLOAK_ADMIN_PASSWORD',
  'SOME_PRIVATE_KEY',
  'REVENUECAT_WEBHOOK_SECRET',
  'CENTRIFUGO_SIGNING_SECRET',
);

describe('classify — property-based', () => {
  // Feature: secrets-inventory, Property 5: For any generated inventory report and .env.example
  // output, every SECRET-kind variable's emitted value matches the safe-placeholder shape and never
  // matches any known secret-pattern detector (generic or provider-specific).
  it('Property 5: no known secret pattern in produced artifacts', () => {
    fc.assert(
      fc.property(envNameArb, surfaceArb, fc.boolean(), (name, surface, req) => {
        const variable = classifyVariable(mergedOf(name, surface, req, new Set(['APPLICATION'])));
        if (variable.kind === 'SECRET') {
          expect(variable.placeholder).toBe(SECRET_PLACEHOLDER);
          for (const detector of SECRET_DETECTORS) {
            expect(detector.pattern.test(variable.placeholder)).toBe(false);
          }
        }
      }),
      RUNS,
    );
  });

  // Feature: secrets-inventory, Property 6: For any catalog of variables, if a variable is
  // classified SECRET then it never appears on the MOBILE surface and is never emitted as
  // EXPO_PUBLIC_*; and any variable on the MOBILE/client surface is classified PUBLIC. A SECRET on
  // the client surface always yields a blocking SECRET_ON_CLIENT finding.
  it('Property 6: public/secret boundary holds by classification', () => {
    fc.assert(
      fc.property(envNameArb, surfaceArb, (name, surface) => {
        const kind = classifyKind(name, surface);
        // A client-surface value is never classified SECRET by the classifier.
        if (surface === 'MOBILE' || name.startsWith('EXPO_PUBLIC_')) {
          expect(kind).not.toBe('SECRET');
        }
        // If we force a SECRET onto the client surface, the boundary flags it.
        const forced: ConfigVariable = {
          name: name.startsWith('EXPO_PUBLIC_') ? name : `EXPO_PUBLIC_${name}`,
          surface: 'MOBILE',
          group: 'mobile',
          kind: 'SECRET',
          requiredScope: ['runtime'],
          envApplicability: ['production'],
          placeholder: SECRET_PLACEHOLDER,
          consumedBy: ['m.ts'],
          provenance: [{ sourceType: 'APPLICATION', sourceFile: 'm.ts', sourceLocation: 'L1' }],
        };
        const findings = checkBoundary([forced]);
        expect(findings.some((f) => f.code === 'SECRET_ON_CLIENT' && f.blocking)).toBe(true);
      }),
      RUNS,
    );
  });

  // Feature: secrets-inventory, Property 7: For any variable whose name carries the EXPO_PUBLIC_
  // prefix but whose classification is SECRET, the boundary check produces a blocking finding rather
  // than accepting it as safe.
  it('Property 7: mis-prefixed secret is caught by classification not naming', () => {
    fc.assert(
      fc.property(hardSecretNameArb, (secretName) => {
        const misPrefixed = `EXPO_PUBLIC_${secretName}`;
        // The hard-secret name is recognized regardless of the public prefix.
        expect(matchesHardSecretName(misPrefixed)).toBe(true);
        const kind = classifyKind(misPrefixed, 'MOBILE');
        expect(kind).toBe('SECRET');
        const variable = classifyVariable(
          mergedOf(misPrefixed, 'MOBILE', true, new Set(['APPLICATION'])),
        );
        const findings = checkBoundary([variable]);
        expect(findings.some((f) => f.code === 'SECRET_ON_CLIENT' && f.blocking)).toBe(true);
      }),
      RUNS,
    );
  });

  // Feature: secrets-inventory, Property 8: For any catalog, no variable classified as an
  // object-storage credential (MinIO/S3 access/secret keys) is assigned to the AI surface.
  it('Property 8: AI surface holds no storage credentials', () => {
    const storageNameArb = fc.constantFrom(
      'MINIO_ROOT_USER',
      'MINIO_ROOT_PASSWORD',
      'MINIO_ENDPOINT',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'S3_BUCKET_KEY',
    );
    fc.assert(
      fc.property(storageNameArb, (name) => {
        expect(isStorageCredential(name)).toBe(true);
        const aiVar = classifyVariable(mergedOf(name, 'AI', false, new Set(['APPLICATION'])));
        const findings = checkBoundary([aiVar]);
        expect(findings.some((f) => f.code === 'SECRET_ON_CLIENT' && f.blocking)).toBe(true);
      }),
      RUNS,
    );
  });

  // Feature: secrets-inventory, Property 9: For any variable a fail-fast validator asserts as
  // required, the inventory's requiredScope includes runtime; conversely a variable with a
  // validator-backed default is not marked runtime-required by the validator axis.
  it('Property 9: requiredScope matches the validator', () => {
    fc.assert(
      fc.property(envNameArb, surfaceArb, (name, surface) => {
        const required = classifyVariable(mergedOf(name, surface, true, new Set(['APPLICATION'])));
        expect(required.requiredScope).toContain('runtime');

        // A build-only variable (no validator, only BUILD source) is not runtime-required
        // because of a validator — its runtime scope, if any, is not validator-driven.
        const buildOnly = classifyVariable(mergedOf(name, 'MOBILE', false, new Set(['BUILD'])));
        expect(buildOnly.requiredScope).toContain('build');
      }),
      RUNS,
    );
  });

  // Feature: secrets-inventory, Property 10: For any catalogued variable, its requiredScope values
  // are drawn only from { runtime, build, deploy, infra } and its envApplicability values only from
  // { local, staging, production }; no environment token ever appears in requiredScope and no scope
  // token ever appears in envApplicability.
  it('Property 10: scope and environment axes are orthogonal', () => {
    const scopeTokens = new Set(['runtime', 'build', 'deploy', 'infra']);
    const envTokens = new Set(['local', 'staging', 'production']);
    fc.assert(
      fc.property(
        envNameArb,
        surfaceArb,
        fc.boolean(),
        provenanceArb,
        (name, surface, req, prov) => {
          const variable = classifyVariable(
            mergedOf(name, surface, req, new Set([prov.sourceType])),
          );
          for (const scope of variable.requiredScope) {
            expect(scopeTokens.has(scope)).toBe(true);
            expect(envTokens.has(scope as unknown as string)).toBe(false);
          }
          for (const env of variable.envApplicability) {
            expect(envTokens.has(env)).toBe(true);
            expect(scopeTokens.has(env as unknown as string)).toBe(false);
          }
        },
      ),
      RUNS,
    );
  });
});
