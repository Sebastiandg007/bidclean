/**
 * service-tracking domain types + error strings (Spec 17).
 *
 * Internal contracts for the session state machine, the eligibility/geofence decision, position
 * ingress (Option A), and the outbox fan-out. Coordinates are client telemetry, never proof of
 * physical presence, and are NEVER persisted as a trail or embedded in an error string/log — only
 * structural/authorization/lifecycle facts appear here. The sole durable location datum is the
 * scalar `arrivalDistanceM`.
 */

/** Session lifecycle states (VARCHAR + app validation, never a PG enum). */
export const SessionState = {
  MATCHED: 'MATCHED',
  EN_ROUTE: 'EN_ROUTE',
  ARRIVED: 'ARRIVED',
  IN_PROGRESS: 'IN_PROGRESS',
  CANCELED: 'CANCELED',
  EXPIRED: 'EXPIRED',
} as const;
export type SessionState = (typeof SessionState)[keyof typeof SessionState];

/** The non-terminal states: a session in one of these is still live and mutable. */
export const NON_TERMINAL_STATES: readonly SessionState[] = [
  SessionState.MATCHED,
  SessionState.EN_ROUTE,
  SessionState.ARRIVED,
];

/** Terminal-for-tracking states: immutable audit facts once reached. */
export const TERMINAL_STATES: readonly SessionState[] = [
  SessionState.IN_PROGRESS,
  SessionState.CANCELED,
  SessionState.EXPIRED,
];

/** Differentiated end reasons (paired with a terminal state). */
export const EndedReason = {
  STARTED: 'STARTED',
  CANCELED_OFFER_TERMINAL: 'CANCELED_OFFER_TERMINAL',
  CANCELED_BY_PARTICIPANT: 'CANCELED_BY_PARTICIPANT',
  EXPIRED_NO_PROGRESS: 'EXPIRED_NO_PROGRESS',
  EXPIRED_NEVER_STARTED: 'EXPIRED_NEVER_STARTED',
  EXPIRED_PROPERTY_REMOVED: 'EXPIRED_PROPERTY_REMOVED',
} as const;
export type EndedReason = (typeof EndedReason)[keyof typeof EndedReason];

/** Whether a state is non-terminal (still live/mutable). */
export function isNonTerminalState(state: string): state is SessionState {
  return (NON_TERMINAL_STATES as readonly string[]).includes(state);
}

/** Whether a state is terminal-for-tracking (immutable). */
export function isTerminalState(state: string): state is SessionState {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

/** The outbox event types service-tracking emits (fanned out to Spec 16 / Spec 18). */
export const ServiceOutboxEventType = {
  EN_ROUTE: 'service_en_route',
  ARRIVED: 'service_arrived',
  STARTED: 'service_started',
} as const;
export type ServiceOutboxEventType =
  (typeof ServiceOutboxEventType)[keyof typeof ServiceOutboxEventType];

/**
 * A single position sample as received on the ingress endpoint. Coordinates are client telemetry
 * (not proof of physical presence); `at` is the client-reported capture time in epoch ms.
 */
export interface PositionSample {
  readonly lat: number;
  readonly lng: number;
  readonly accuracy: number;
  readonly heading?: number;
  readonly at: number;
}

/** The eligibility gates a sample must pass before it can drive the arrival decision. */
export interface EligibilityConfig {
  readonly maxAccuracyM: number;
  readonly maxAgeMs: number;
  readonly maxClockSkewMs: number;
}

/** Result of the PostGIS geofence evaluation over the session's snapshot. */
export interface GeofenceResult {
  readonly within: boolean;
  /** The geometric geodesic distance (metres) from the reported point to the property. */
  readonly distanceM: number;
}

/**
 * The durable activation fact payload (offer MATCHED AND escrow CAPTURED), emitted upstream by the
 * offer/escrow path and consumed idempotently to create a session. Ids only — never PII.
 */
export interface ActivationPayload {
  readonly offerId: string;
  readonly hostId: string;
  readonly cleanerId: string;
  readonly propertyId: string;
}

/** The client-facing session view (reconciliation read). Never carries a live coordinate. */
export interface ServiceSessionView {
  readonly id: string;
  readonly offerId: string;
  readonly hostId: string | null;
  readonly cleanerId: string | null;
  readonly propertyId: string | null;
  readonly state: SessionState;
  readonly endedReason: EndedReason | null;
  readonly geofenceRadiusM: number;
  /** The property geofence centre `{ lat, lng }` (snapshot), for the map destination render. */
  readonly propertyLocation: { readonly lat: number; readonly lng: number } | null;
  readonly enRouteAt: string | null;
  readonly arrivedAt: string | null;
  readonly startedAt: string | null;
  readonly arrivalDistanceM: number | null;
  readonly createdAt: string;
}

/**
 * service-tracking error messages.
 *
 * Non-sensitive, structural/authorization/lifecycle strings only. Never embed a coordinate,
 * participant PII, or any sensitive content — so nothing leaks into logs or responses.
 */
export const SERVICE_ERROR_MESSAGES = {
  /** The referenced session does not exist (or the caller may not learn it does). */
  SESSION_NOT_FOUND: 'Service session not found',
  /** The caller is not one of the session's two participants. */
  NOT_A_PARTICIPANT: 'Not a participant of this service session',
  /** The action requires the Cleaner role on the session. */
  NOT_THE_CLEANER: 'Only the assigned cleaner may perform this action',
  /** The requested lifecycle transition is not permitted from the session's current state. */
  ILLEGAL_TRANSITION: 'This service session transition is not allowed',
  /** The authenticated Keycloak subject does not resolve to a BidClean user. */
  USER_NOT_FOUND: 'User not found',
} as const;
