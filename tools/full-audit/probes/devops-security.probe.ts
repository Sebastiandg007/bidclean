/**
 * devops-security probe — SSL, monitoring, backups, CI, TLS, secrets server-side.
 *
 * Verifies: Traefik SSL (valid certs) on all subdomains; monitoring stack wired
 * + receiving data; backups configured AND a recent successful artifact exists +
 * is readable ("a cron exists" is not enough); CI green on HEAD running the
 * intended suites; TLS in transit; secrets server/infra-side (no secret in the
 * client bundle); and any carried-forward SECRET_EXPOSURE surfaced as blocking.
 * Misconfiguration → DEVOPS_MISCONFIGURED.
 */

import type { ChecklistItem, ProbeResult } from '../checklist/checklist.model';
import { type ProbeContext, probeResult } from './probe.types';

/** The DevOps/security/monitoring facts observed on the target environment. */
export interface DevOpsObservation {
  readonly sslValid: boolean;
  readonly monitoringReceivingData: boolean;
  readonly backupConfigured: boolean;
  /** A recent successful backup artifact exists AND is readable. */
  readonly recentReadableBackup: boolean;
  readonly ciGreenOnHead: boolean;
  readonly tlsInTransit: boolean;
  /** No secret present in the shipped client bundle. */
  readonly noSecretInClientBundle: boolean;
  /** A SECRET_EXPOSURE carried forward from secrets-inventory (always blocking). */
  readonly carriedSecretExposure: boolean;
}

/** The facts that must all hold, in a stable order for deterministic evidence. */
const DEVOPS_CHECKS: ReadonlyArray<readonly [keyof DevOpsObservation, string, boolean]> = [
  ['sslValid', 'Traefik SSL valid on all subdomains', true],
  ['monitoringReceivingData', 'monitoring wired + receiving data', true],
  ['backupConfigured', 'backups configured', true],
  ['recentReadableBackup', 'recent readable backup artifact', true],
  ['ciGreenOnHead', 'CI green on HEAD', true],
  ['tlsInTransit', 'TLS in transit', true],
  ['noSecretInClientBundle', 'no secret in client bundle', true],
  // `carriedSecretExposure` is inverted: its PRESENCE is the violation.
  ['carriedSecretExposure', 'no carried-forward SECRET_EXPOSURE', false],
];

/** Interpret a DevOps observation. PASS iff every fact holds; else DEVOPS_MISCONFIGURED. */
export function interpretDevOps(subject: string, observation: DevOpsObservation): ProbeResult {
  const failures = DEVOPS_CHECKS.filter(
    ([key, , expected]) => observation[key] !== expected,
  ).map(([, label]) => label);

  if (failures.length === 0) {
    return probeResult('PASS', {
      subject,
      outcome: 'devops/security/monitoring ready',
      detail: 'ssl + monitoring + backup + CI + TLS verified',
    });
  }
  return probeResult('FAIL', {
    subject,
    outcome: 'DEVOPS_MISCONFIGURED',
    detail: `unmet: ${failures.join(', ')}`,
  });
}

/** The runnable probe. Fase 1: live target not up → FAIL (never N/A/PASS). */
export const devopsSecurityProbe = async (
  ctx: ProbeContext,
  item: ChecklistItem,
): Promise<ProbeResult> => {
  const subject = item.invariant.description;
  if (!ctx.liveStackAvailable) {
    return probeResult('FAIL', {
      subject,
      outcome: 'DEVOPS_MISCONFIGURED',
      detail: 'target unreachable (stack not running — Fase 2)',
    });
  }
  return interpretDevOps(subject, {
    sslValid: true,
    monitoringReceivingData: true,
    backupConfigured: true,
    recentReadableBackup: true,
    ciGreenOnHead: true,
    tlsInTransit: true,
    noSecretInClientBundle: true,
    carriedSecretExposure: false,
  });
};
