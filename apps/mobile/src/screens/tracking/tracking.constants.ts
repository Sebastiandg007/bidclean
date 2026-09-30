/**
 * tracking.constants — Mobile config, endpoints, channel naming, and i18n keys for service tracking.
 *
 * Endpoints mirror the backend `service-sessions` controller + the auth Centrifugo token route.
 * Tunables come from `EXPO_PUBLIC_*` with sensible fallbacks (no magic numbers in logic). The
 * channel prefix matches the backend so subscription channel names line up. The Cleaner's send
 * cadence is a client-side pre-throttle only — the server INDEPENDENTLY rate-limits.
 */

/** Backend REST endpoints for service tracking. */
export const TRACKING_ENDPOINTS = {
  session: (id: string): string => `/service-sessions/${id}`,
  enRoute: (id: string): string => `/service-sessions/${id}/en-route`,
  position: (id: string): string => `/service-sessions/${id}/position`,
  start: (id: string): string => `/service-sessions/${id}/start`,
  cancel: (id: string): string => `/service-sessions/${id}/cancel`,
} as const;

/** Auth-owned Centrifugo token endpoint (connection + per-channel subscription tokens). */
export const CENTRIFUGO_TOKEN_URL =
  process.env.EXPO_PUBLIC_CENTRIFUGO_TOKEN_URL ?? '/auth/centrifugo/token';

/** Centrifugo WebSocket URL. */
export const CENTRIFUGO_WS_URL =
  process.env.EXPO_PUBLIC_CENTRIFUGO_WS_URL ?? 'wss://ws.bidclean.tech/connection/websocket';

/** Per-session channel prefix (matches the backend `SERVICE_POSITION_CHANNEL_PREFIX`). */
export const SERVICE_CHANNEL_PREFIX = 'service:session:';

/** Build the Centrifugo channel name for a session. */
export function serviceChannelForSession(sessionId: string): string {
  return `${SERVICE_CHANNEL_PREFIX}${sessionId}`;
}

/** Navigation route names for the tracking screens (mounted in both role stacks). */
export const EN_ROUTE_SCREEN_ROUTE = 'EnRoute';
export const TRACKING_SCREEN_ROUTE = 'Tracking';

/**
 * Client-side position send cadence (ms) — a UX pre-throttle ONLY. The server independently
 * rate-limits (never trusting the client to self-limit).
 */
export const SERVICE_POSITION_MIN_INTERVAL_MS = parseInt(
  process.env.EXPO_PUBLIC_SERVICE_POSITION_MIN_INTERVAL_MS ?? '3000',
  10,
);

/** Reconnect backoff bounds (mirrors the chat/radar hook sequence 1s→2s→…→30s). */
export const WS_INITIAL_BACKOFF_MS = 1000;
export const WS_MAX_BACKOFF_MS = 30000;

/** Default map camera zoom when framing the destination (Mapbox render only). */
export const MAP_DEFAULT_ZOOM = parseInt(process.env.EXPO_PUBLIC_TRACKING_MAP_ZOOM ?? '14', 10);

/** BidClean dark design tokens used by the tracking screens. */
export const TRACKING_COLORS = {
  ACCENT: '#00F5D4',
  CARD: '#1F2833',
  BACKGROUND: '#0B0C10',
  TEXT: '#FFFFFF',
} as const;

/** i18n keys for the tracking UI (en/es in parity). */
export const TRACKING_I18N_KEYS = {
  EN_ROUTE_TITLE: 'tracking.enRoute.title',
  TRACKING_TITLE: 'tracking.host.title',
  STATE_MATCHED: 'tracking.state.matched',
  STATE_ON_THE_WAY: 'tracking.state.onTheWay',
  STATE_ARRIVED: 'tracking.state.arrived',
  STATE_STARTED: 'tracking.state.started',
  STATE_CANCELED: 'tracking.state.canceled',
  STATE_EXPIRED: 'tracking.state.expired',
  CLEANER_ARRIVED: 'tracking.host.cleanerArrived',
  LOCATION_UNAVAILABLE: 'tracking.host.locationUnavailable',
  START_HEADING: 'tracking.enRoute.startHeading',
  START_WORK: 'tracking.enRoute.startWork',
  ETA_LABEL: 'tracking.enRoute.eta',
  DESTINATION: 'tracking.enRoute.destination',
  PERMISSION_DENIED: 'tracking.enRoute.permissionDenied',
  PERMISSION_EXPLAINER: 'tracking.enRoute.permissionExplainer',
  CONNECTION_CONNECTED: 'tracking.connection.connected',
  CONNECTION_CONNECTING: 'tracking.connection.connecting',
  CONNECTION_RECONNECTING: 'tracking.connection.reconnecting',
  CONNECTION_DISCONNECTED: 'tracking.connection.disconnected',
  LOAD_ERROR: 'tracking.loadError',
} as const;
