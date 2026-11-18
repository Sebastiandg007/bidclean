/**
 * Checklist + readiness model — the single auditable artifact's types.
 *
 * An item SEPARATES its `invariant` (the expected condition — identical across
 * environments) from its per-environment `probes` (HOW it is checked — MAY differ
 * local vs VPS), so "same criteria across environments" means the same invariant,
 * not an identical probe. Status is TRI-STATE and an `N/A` REQUIRES a justification.
 */

import type { ProbeRef } from '../registry/component-registry';

/** The two audited environments. Local is audited first, then the VPS. */
export type Environment = 'local' | 'vps';

/** Tri-state item status. `N/A` is never counted as `PASS`. */
export type Status = 'PASS' | 'FAIL' | 'N/A';

/** The seven checklist categories; mirrors the probe families. */
export type CheckCategory =
  | 'COMPONENT_PRESENCE'
  | 'SERVICE_HEALTH'
  | 'INTER_SERVICE_EDGE'
  | 'EXTERNAL_INTEGRATION'
  | 'LIVE_JOURNEY'
  | 'STORE_READINESS'
  | 'DEVOPS_SECURITY';

/** The expected condition — IDENTICAL across environments. */
export interface Invariant {
  readonly id: string;
  /** e.g. "API authenticates to Keycloak via JWKS". */
  readonly description: string;
  readonly category: CheckCategory;
}

/** HOW the invariant is checked in a given environment — MAY differ local vs VPS. */
export interface Probe {
  readonly probeRef: ProbeRef;
  readonly environment: Environment;
  /** Localhost endpoint vs public subdomain, queue name, artifact path, etc. */
  readonly target: string;
}

/** The result of running a probe against the running system. */
export interface ProbeResult {
  readonly status: Status;
  /** Response summary, timing, auth OUTCOME — NEVER a secret value. */
  readonly evidence: string;
  /** ISO timestamp of observation. */
  readonly observedAt: string;
}

/**
 * One verifiable condition on the checklist. `probes[env]` is null iff the item
 * is not applicable in that environment; when a `results[env]` is `N/A`, the
 * matching `applicabilityJustification[env]` MUST be non-empty.
 */
export interface ChecklistItem {
  readonly invariant: Invariant;
  /** Owning spec/module — the finding routing target. */
  readonly owner: string;
  readonly mandatory: boolean;
  readonly probes: Readonly<Record<Environment, Probe | null>>;
  readonly results: Partial<Record<Environment, ProbeResult>>;
  readonly applicabilityJustification: Partial<Record<Environment, string>>;
}

/** Why a checklist item produced a finding. All readiness findings are blocking. */
export type FindingReason =
  | 'MISSING_OR_DOWN' // required component absent/unhealthy
  | 'DEAD_EDGE' // edge configured but unreachable/unauthenticated
  | 'UNWIRED_COMPONENT' // present but not integrated (no consume/emit)
  | 'CHAIN_NOT_FIRING' // durable event chain never fires end-to-end
  | 'REGISTRY_STALE' // registry diverges from owning specs'/ARCHITECTURE's declared components
  | 'LIVE_JOURNEY_FAILED'
  | 'PARITY_BREAK' // PASS local, FAIL vps (or vice-versa) on a mandatory+applicable item
  | 'UNJUSTIFIED_NA' // N/A on a mandatory item without a justification
  | 'INVALID_STORE_ARTIFACT'
  | 'DEVOPS_MISCONFIGURED'
  | 'SECRET_EXPOSURE'; // carried forward from secrets-inventory

/** A routed, blocking readiness finding. `evidence` is NEVER a secret value. */
export interface Finding {
  readonly reason: FindingReason;
  readonly invariantId: string;
  readonly environment: Environment | 'both';
  readonly evidence: string;
  readonly owner: string;
  readonly blocking: boolean;
}

export type Verdict = 'READY' | 'NOT_READY';

/** The terminal report: checklist state + routed findings + verdict. */
export interface ReadinessReport {
  readonly items: readonly ChecklistItem[];
  readonly findings: readonly Finding[];
  /** READY iff no blocking finding across BOTH environments. */
  readonly verdict: Verdict;
}
