/**
 * Probe registry — maps each probe family to its runnable `Probe`.
 *
 * The CLI selects a probe by the checklist item's `probeRef.probeType`. Keeping
 * the mapping in one place makes "the seven probe families" a closed, checkable
 * set that mirrors `CheckCategory` and `ProbeType`.
 */

import type { ProbeType } from '../registry/component-registry';
import type { Probe } from './probe.types';
import { componentPresenceProbe } from './component-presence.probe';
import { serviceHealthProbe } from './service-health.probe';
import { interServiceEdgeProbe } from './inter-service-edge.probe';
import { externalIntegrationProbe } from './external-integration.probe';
import { liveJourneyProbe } from './live-journey.probe';
import { storeReadinessProbe } from './store-readiness.probe';
import { devopsSecurityProbe } from './devops-security.probe';

/** The seven probe families, keyed by probe type. */
export const PROBES: Readonly<Record<ProbeType, Probe>> = {
  'component-presence': componentPresenceProbe,
  'service-health': serviceHealthProbe,
  'inter-service-edge': interServiceEdgeProbe,
  'external-integration': externalIntegrationProbe,
  'live-journey': liveJourneyProbe,
  'store-readiness': storeReadinessProbe,
  'devops-security': devopsSecurityProbe,
};

/** Resolve the probe for a probe type (every type has a defined, non-trivial probe). */
export function probeFor(probeType: ProbeType): Probe {
  return PROBES[probeType];
}

export * from './probe.types';
