/**
 * tracking.types — Mobile domain types for service tracking (Spec 17).
 *
 * Mirrors the backend `service-tracking` contracts (session view + live position). Live position is
 * ephemeral realtime transport only (never persisted); the sole durable location datum is
 * `arrivalDistanceM`. The Cleaner reports position to the backend (Option A) and never publishes to
 * the channel; the Host is a read-only subscriber.
 */

/** Session lifecycle state (server-authoritative). */
export type SessionState =
  | 'MATCHED'
  | 'EN_ROUTE'
  | 'ARRIVED'
  | 'IN_PROGRESS'
  | 'CANCELED'
  | 'EXPIRED';

/** WebSocket connection status surfaced to the UI. */
export type ConnectionStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';

/** A property point (the geofence centre / map destination). */
export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

/** The client-facing session view (matches the backend `ServiceSessionView`). */
export interface ServiceSession {
  readonly id: string;
  readonly offerId: string;
  readonly hostId: string | null;
  readonly cleanerId: string | null;
  readonly propertyId: string | null;
  readonly state: SessionState;
  readonly endedReason: string | null;
  readonly geofenceRadiusM: number;
  readonly propertyLocation: GeoPoint | null;
  readonly enRouteAt: string | null;
  readonly arrivedAt: string | null;
  readonly startedAt: string | null;
  readonly arrivalDistanceM: number | null;
  readonly createdAt: string;
}

/** A live position sample (ephemeral; never persisted as history). */
export interface LivePosition {
  readonly lat: number;
  readonly lng: number;
  readonly accuracy: number;
  readonly heading: number | null;
  readonly at: number;
}

/** A realtime `state` signal received over the session channel (best-effort). */
export interface StateSignal {
  readonly type: 'state';
  readonly state: SessionState;
  readonly endedReason?: string | null;
}

/** A realtime `position` signal received over the session channel (best-effort). */
export interface PositionSignal {
  readonly type: 'position';
  readonly lat: number;
  readonly lng: number;
  readonly accuracy: number;
  readonly heading?: number | null;
  readonly at: number;
}
