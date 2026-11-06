/**
 * Probe contract + shared, secret-safe evidence builder.
 *
 * A probe produces a `ProbeResult` from the RUNNING system for one checklist
 * item in one environment. The evidence-builder records outcome BY NAME/OUTCOME
 * only ("authenticated", "JWKS valid") and structurally never embeds a secret
 * value, so no probe result, finding, or serialized report can leak a credential.
 */

import type { ChecklistItem, ProbeResult, Status } from '../checklist/checklist.model';
import type { Environment } from '../checklist/checklist.model';

/** Running-system connection info for an environment, resolved from config. */
export interface ProbeContext {
  readonly environment: Environment;
  /** Resolved endpoints/targets per component id — NEVER raw secrets. */
  readonly targets: Readonly<Record<string, string>>;
  /**
   * Whether the live stack is reachable from this run. In Fase 1 the stack is
   * not up, so edge/integration/journey probes resolve to FAIL with an honest
   * "target unreachable" evidence rather than N/A or a crash.
   */
  readonly liveStackAvailable: boolean;
}

/** A probe: given the running-system context + the item, produce a result. */
export type Probe = (ctx: ProbeContext, item: ChecklistItem) => Promise<ProbeResult>;

/**
 * Structured, secret-safe observation passed to `buildEvidence`. Only outcome
 * tokens are ever recorded — there is no field that can carry a secret value.
 */
export interface EvidenceInput {
  /** What was probed, e.g. "API→Keycloak JWKS". */
  readonly subject: string;
  /** The outcome token, e.g. "authenticated", "JWKS valid", "reachable". */
  readonly outcome: string;
  /** Optional non-secret detail, e.g. timing, http status, counts. */
  readonly detail?: string;
}

/** The shape of a known secret value we must never emit (defense in depth). */
const SECRET_SHAPES: readonly RegExp[] = [
  /sk_(live|test)_[A-Za-z0-9]{8,}/, // Stripe secret keys
  /AKIA[0-9A-Z]{16}/, // AWS access key id
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM private key
];

/**
 * Build evidence from structured outcome tokens. Any attempt to pass a
 * secret-shaped substring is scrubbed to a redaction marker — the function
 * CANNOT emit a secret value, by construction. Returns a safe one-line string.
 */
export function buildEvidence(input: EvidenceInput): string {
  const base = input.detail
    ? `${input.subject}: ${input.outcome} (${input.detail})`
    : `${input.subject}: ${input.outcome}`;
  return scrubSecrets(base);
}

/** Replace any secret-shaped substring with a redaction marker. */
export function scrubSecrets(text: string): string {
  let safe = text;
  for (const shape of SECRET_SHAPES) {
    safe = safe.replace(new RegExp(shape, 'g'), '[REDACTED]');
  }
  return safe;
}

/** True iff the text contains a known secret shape (used by tests/guards). */
export function containsSecretShape(text: string): boolean {
  return SECRET_SHAPES.some((shape) => shape.test(text));
}

/** Convenience: assemble a `ProbeResult` with a scrubbed evidence string. */
export function probeResult(status: Status, evidence: EvidenceInput): ProbeResult {
  return {
    status,
    evidence: buildEvidence(evidence),
    observedAt: new Date().toISOString(),
  };
}

/** The honest Fase-1 FAIL for a probe that requires the live stack to be up. */
export function stackUnreachableResult(subject: string): ProbeResult {
  return probeResult('FAIL', {
    subject,
    outcome: 'target unreachable',
    detail: 'stack not running — Fase 2',
  });
}
