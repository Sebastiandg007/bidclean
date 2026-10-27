/**
 * Component registry types — the checkable definition of "every component".
 *
 * The registry is authoritative for "what must exist and be wired": a component
 * is "real" only because the registry declares it. It enumerates not just the
 * top-level services/infra but the internal modules that can be "up but unwired"
 * (Nest modules, BullMQ workers, outbox/event consumers, scheduled jobs, webhook
 * ingresses, AI endpoints, mobile feature modules, notification consumers).
 *
 * See design.md "Authority chain": COMPONENT REGISTRY → PROBES → CHECKLIST → VERDICT.
 */

/** Which runtime surface a component belongs to. */
export type Surface = 'API' | 'AI' | 'MOBILE' | 'INFRA';

/** In which environment(s) a component is required to be present + wired. */
export type RequiredInEnvironment = 'local' | 'vps' | 'both';

/** The seven probe families; mirrors CheckCategory in the checklist model. */
export type ProbeType =
  | 'component-presence'
  | 'service-health'
  | 'inter-service-edge'
  | 'external-integration'
  | 'live-journey'
  | 'store-readiness'
  | 'devops-security';

/** Reference to a probe that verifies a specific condition. */
export interface ProbeRef {
  /** Which probe family runs this check. */
  readonly probeType: ProbeType;
  /** Stable id, referenced by checklist items. */
  readonly probeId: string;
}

/** A durable event a component consumes or produces (kept minimal). */
export interface EventRef {
  /** e.g. 'offer.matched', 'service_arrived', 'checklist_completed'. */
  readonly eventName: string;
  /** Queue/topic/table/channel it flows on, e.g. 'offer_outbox', 'service_outbox'. */
  readonly channel?: string;
}

/**
 * A single registered component in the closed registry.
 *
 * For an event-driven entry (a worker, outbox/event consumer, webhook ingress,
 * notification consumer), `dependencies` + a single `integrationProbe` is not
 * enough to prove integration completeness: "worker A depends on Redis" does not
 * prove worker A actually consumes queue X and emits event Y. So an event-driven
 * entry declares the events it `consumes`/`produces`, and THOSE declared events
 * are exactly what the `integrationProbe` verifies end-to-end on the running
 * system (a declared event that never fires is an UNWIRED_COMPONENT /
 * CHAIN_NOT_FIRING FAIL). Both fields are optional — a stateless HTTP module
 * declares neither and its `integrationProbe` remains the edge/reachability check.
 */
export interface ComponentEntry {
  /** Stable id, e.g. 'api.offers.radius-expansion-worker', 'ai.verify-face'. */
  readonly componentId: string;
  /** Owning spec/module accountable for the component (finding routing target). */
  readonly owner: string;
  readonly surface: Surface;
  /** How it is reached/registered: route, queue name, consumer, cron, container. */
  readonly entryPoint: string;
  /** Other componentIds it depends on. */
  readonly dependencies: readonly string[];
  /** OPTIONAL: durable events this component consumes (verified by integrationProbe). */
  readonly consumes?: readonly EventRef[];
  /** OPTIONAL: durable events this component emits (verified by integrationProbe). */
  readonly produces?: readonly EventRef[];
  readonly requiredInEnvironment: RequiredInEnvironment;
  /** Liveness signal — NOT integration proof. */
  readonly healthProbe: ProbeRef;
  /** Wired-into-the-system proof (edge / consumer / emitter). */
  readonly integrationProbe: ProbeRef;
}

/** True when an entry declares at least one consumed or produced event. */
export function isEventDriven(entry: ComponentEntry): boolean {
  return (entry.consumes?.length ?? 0) > 0 || (entry.produces?.length ?? 0) > 0;
}
