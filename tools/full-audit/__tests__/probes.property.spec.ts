/**
 * Properties 2, 7, 10 for the probe library.
 */

import fc from 'fast-check';
import { interpretHealth } from '../probes/service-health.probe';
import { interpretEdge } from '../probes/inter-service-edge.probe';
import { interpretIntegration } from '../probes/external-integration.probe';
import { buildEvidence, containsSecretShape, scrubSecrets } from '../probes/probe.types';

const RUNS = { numRuns: 200 };

describe('probe library — property-based', () => {
  // Feature: full-audit, Property 2: For any checklist and any set of probe results, an item of
  // category INTER_SERVICE_EDGE or EXTERNAL_INTEGRATION is marked PASS only when its own
  // edge/integration probe returned PASS; a SERVICE_HEALTH PASS on the same component never by
  // itself satisfies an edge/integration item. Readiness for any edge is never derivable from
  // GET /health alone.
  it('Property 2: health is liveness only — never satisfies an edge/integration item', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 200, max: 599 }),
        fc.boolean(),
        fc.boolean(),
        (httpStatus, reachable, authenticated) => {
          // A health PASS (even a 200) says nothing about an edge.
          const health = interpretHealth('API', { httpStatus: 200, reportedStatus: 'ok' });
          expect(health.status).toBe('PASS');
          expect(health.evidence).toContain('liveness');

          // The edge result depends ONLY on the edge call, independent of health.
          const edge = interpretEdge('API→Keycloak', {
            reachable,
            authenticated,
            completed: reachable && authenticated,
          });
          const edgePass = reachable && authenticated;
          expect(edge.status).toBe(edgePass ? 'PASS' : 'FAIL');

          // A non-green health never flips an edge to PASS.
          const unhealthy = interpretHealth('API', { httpStatus });
          if (httpStatus < 200 || httpStatus >= 300) {
            expect(unhealthy.status).toBe('FAIL');
          }
        },
      ),
      RUNS,
    );
  });

  // Feature: full-audit, Property 7: For any probe result, finding, or serialized report, the
  // evidence and finding fields never contain a value matching a known secret shape (the edge/auth
  // probes reference a credential by name/outcome — "authenticated" / "JWKS valid" — never by
  // value). The audit never prints, rotates, or leaks a secret.
  it('Property 7: no secret is ever emitted in evidence', () => {
    const secretShapes = fc.constantFrom(
      'sk_live_abcdefgh12345678',
      'sk_test_abcdefgh12345678',
      'AKIAABCDEFGHIJKLMNOP',
      'eyJabcdefghij.klmnopqrst.uvwxyz123456',
      '-----BEGIN RSA PRIVATE KEY-----',
    );
    fc.assert(
      fc.property(
        fc.constantFrom('API→Keycloak', 'API→Stripe', 'API→MinIO'),
        fc.constantFrom('authenticated', 'JWKS valid', 'reachable'),
        secretShapes,
        (subject, outcome, secret) => {
          // Even if a caller tries to smuggle a secret into detail, it is scrubbed.
          const evidence = buildEvidence({ subject, outcome, detail: `token=${secret}` });
          expect(containsSecretShape(evidence)).toBe(false);
          expect(evidence).not.toContain(secret);
          // scrubSecrets is idempotent and never reintroduces a secret.
          expect(scrubSecrets(evidence)).toBe(evidence);
        },
      ),
      RUNS,
    );
  });

  // Feature: full-audit, Property 10: For any inter-service-edge item, a PASS requires evidence of
  // an actually-completed authenticated call (reachable AND authenticated); a merely-configured
  // edge with no successful authenticated call resolves to FAIL (DEAD_EDGE), never PASS.
  // Configuration presence alone never counts as a live edge.
  it('Property 10: reachable-and-authenticated edge is distinct from configured', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), fc.boolean(), (reachable, authenticated, completed) => {
        const result = interpretEdge('API→MinIO', { reachable, authenticated, completed });
        const live = reachable && authenticated && completed;
        expect(result.status).toBe(live ? 'PASS' : 'FAIL');
        if (!live) {
          expect(result.evidence).toContain('DEAD_EDGE');
        }

        // An integration edge behaves the same under an allowed mode.
        const integration = interpretIntegration('API→Stripe', 'sandbox', {
          reachable,
          authenticated,
        });
        expect(integration.status).toBe(reachable && authenticated ? 'PASS' : 'FAIL');
      }),
      RUNS,
    );
  });
});
