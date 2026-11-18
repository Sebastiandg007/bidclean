/**
 * Example-based unit tests for the evaluator + findings reporter routing.
 */

import { evaluateReadiness } from '../evaluate/readiness-evaluator';
import { reportFindings } from '../evaluate/findings-reporter';
import type { CheckCategory, ChecklistItem } from '../checklist/checklist.model';

/** Build a both-environment item with an explicit status per environment. */
function item(opts: {
  id: string;
  category: CheckCategory;
  owner: string;
  mandatory?: boolean;
  local: 'PASS' | 'FAIL' | 'N/A';
  vps: 'PASS' | 'FAIL' | 'N/A';
  justifyLocal?: boolean;
  justifyVps?: boolean;
}): ChecklistItem {
  const mk = (status: 'PASS' | 'FAIL' | 'N/A') =>
    status === 'N/A'
      ? null
      : {
          probeRef: { probeType: 'component-presence' as const, probeId: 'p' },
          environment: 'local' as const,
          target: 'x',
        };
  const result = (status: 'PASS' | 'FAIL' | 'N/A') =>
    status === 'N/A' ? undefined : { status, evidence: `${status} evidence`, observedAt: 'now' };

  return {
    invariant: { id: opts.id, description: opts.id, category: opts.category },
    owner: opts.owner,
    mandatory: opts.mandatory ?? true,
    probes: { local: mk(opts.local), vps: mk(opts.vps) },
    results: {
      ...(result(opts.local) ? { local: result(opts.local)! } : {}),
      ...(result(opts.vps) ? { vps: result(opts.vps)! } : {}),
    },
    applicabilityJustification: {
      ...(opts.local === 'N/A' && opts.justifyLocal ? { local: 'n/a local' } : {}),
      ...(opts.vps === 'N/A' && opts.justifyVps ? { vps: 'n/a vps' } : {}),
    },
  };
}

describe('evaluator — examples', () => {
  it('all-PASS both envs + valid store → READY', () => {
    const items = [
      item({ id: 'a', category: 'COMPONENT_PRESENCE', owner: 'infra', local: 'PASS', vps: 'PASS' }),
    ];
    const report = evaluateReadiness({ local: items, vps: items, storeArtifactsValid: true });
    expect(report.verdict).toBe('READY');
    expect(report.findings).toHaveLength(0);
  });

  it('one mandatory FAIL → NOT_READY', () => {
    const items = [
      item({ id: 'a', category: 'INTER_SERVICE_EDGE', owner: 'auth', local: 'FAIL', vps: 'FAIL' }),
    ];
    const report = evaluateReadiness({ local: items, vps: items, storeArtifactsValid: true });
    expect(report.verdict).toBe('NOT_READY');
  });

  it('justified N/A on a vps-only item in local → still READY', () => {
    const items = [
      item({
        id: 'certs',
        category: 'DEVOPS_SECURITY',
        owner: 'infra',
        local: 'N/A',
        vps: 'PASS',
        justifyLocal: true,
      }),
    ];
    const report = evaluateReadiness({ local: items, vps: items, storeArtifactsValid: true });
    expect(report.verdict).toBe('READY');
  });

  it('unjustified N/A on a mandatory item → UNJUSTIFIED_NA finding', () => {
    const items = [
      item({ id: 'a', category: 'COMPONENT_PRESENCE', owner: 'infra', local: 'N/A', vps: 'PASS' }),
    ];
    const report = evaluateReadiness({ local: items, vps: items, storeArtifactsValid: true });
    expect(report.findings.some((f) => f.reason === 'UNJUSTIFIED_NA')).toBe(true);
    expect(report.verdict).toBe('NOT_READY');
  });

  it('invalid store artifacts → NOT_READY with INVALID_STORE_ARTIFACT', () => {
    const report = evaluateReadiness({ local: [], vps: [], storeArtifactsValid: false });
    expect(report.verdict).toBe('NOT_READY');
    expect(report.findings.some((f) => f.reason === 'INVALID_STORE_ARTIFACT')).toBe(true);
  });
});

describe('findings reporter — routing examples', () => {
  it('a DEAD_EDGE on API→Keycloak routes to the auth owner', () => {
    const items = [
      item({
        id: 'edge:keycloak',
        category: 'INTER_SERVICE_EDGE',
        owner: 'user-authentication',
        local: 'FAIL',
        vps: 'FAIL',
      }),
    ];
    const report = evaluateReadiness({ local: items, vps: items, storeArtifactsValid: true });
    const routed = reportFindings(report);
    const deadEdge = routed.find((f) => f.reason === 'DEAD_EDGE');
    expect(deadEdge?.owner).toBe('user-authentication');
  });

  it('an INVALID_STORE_ARTIFACT routes to the mobile-build owner', () => {
    const items = [
      item({
        id: 'store:aab',
        category: 'STORE_READINESS',
        owner: 'apps/mobile',
        local: 'FAIL',
        vps: 'FAIL',
      }),
    ];
    const report = evaluateReadiness({ local: items, vps: items, storeArtifactsValid: true });
    const routed = reportFindings(report);
    const store = routed.find((f) => f.reason === 'INVALID_STORE_ARTIFACT');
    expect(store?.owner).toBe('apps/mobile');
  });
});
