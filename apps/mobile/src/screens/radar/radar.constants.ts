/**
 * Radar screen constants.
 *
 * Timing intervals, WebSocket reconnection, Mapbox layer IDs,
 * clustering config, animation springs, and service type icon mapping.
 * All env-configurable values use EXPO_PUBLIC_ prefix for Expo compatibility.
 */

import type { ServiceType } from '../offers/offers.types';

// ─── Polling & Timing ────────────────────────────────────────────────────────

/** Interval for REST polling fallback when WebSocket fails (ms) */
export const RADAR_POLLING_INTERVAL_MS = Number(
  process.env.EXPO_PUBLIC_RADAR_POLLING_INTERVAL_MS ?? '30000',
);

/** Maximum duration for polling fallback before showing permanent reconnecting state (ms) */
export const RADAR_MAX_POLLING_DURATION_MS = Number(
  process.env.EXPO_PUBLIC_RADAR_MAX_POLLING_DURATION_MS ?? '300000',
);

/** Interval for client-side urgency recalculation (ms) */
export const URGENCY_REFRESH_INTERVAL_MS = 60_000;

/** Threshold for classifying an offer as urgent: scheduled within this many ms */
export const URGENCY_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

// ─── WebSocket Reconnection ──────────────────────────────────────────────────

/** Maximum backoff delay between WebSocket reconnection attempts (ms) */
export const WS_MAX_BACKOFF_MS = Number(
  process.env.EXPO_PUBLIC_WS_MAX_BACKOFF_MS ?? '30000',
);

/** Number of failed reconnection attempts before switching to REST polling fallback */
export const WS_FALLBACK_THRESHOLD = 3;

/** Initial backoff delay for first reconnection attempt (ms) */
export const WS_INITIAL_BACKOFF_MS = 1000;

/** Maximum overlap window during WS → polling transition (ms) */
export const WS_POLLING_OVERLAP_MAX_MS = 5000;

// ─── Mapbox Layer IDs ────────────────────────────────────────────────────────

export const LAYER_IDS = {
  WORK_ZONE_FILL: 'work-zone-fill',
  WORK_ZONE_BORDER: 'work-zone-border',
  OFFER_PINS: 'offer-pins-layer',
  CLUSTER_CIRCLES: 'cluster-circles-layer',
  CLUSTER_COUNT: 'cluster-count-layer',
  CLEANER_MARKER: 'cleaner-marker-layer',
} as const;

export const SOURCE_IDS = {
  OFFERS: 'offers-source',
  CLEANER_POSITION: 'cleaner-position-source',
  WORK_ZONE: 'work-zone-source',
} as const;

// ─── Mapbox Clustering ───────────────────────────────────────────────────────

export const CLUSTER_CONFIG = {
  /** Radius in pixels for grouping points into a cluster */
  CLUSTER_RADIUS: 50,
  /** Zoom level above which clustering is disabled (individual pins shown) */
  CLUSTER_MAX_ZOOM: 14,
  /** Minimum points to form a cluster */
  CLUSTER_MIN_POINTS: 2,
} as const;

/** Zoom increment when tapping a cluster to expand it */
export const CLUSTER_TAP_ZOOM_INCREMENT = 2;

// ─── Pin Animation (Reanimated 3 Spring) ─────────────────────────────────────

/** Spring config for pin entrance animation (drop + bounce) */
export const PIN_ENTRANCE_SPRING = {
  damping: 12,
  stiffness: 150,
  mass: 0.8,
} as const;

/** Spring config for pin exit animation (fade + scale down) */
export const PIN_EXIT_SPRING = {
  damping: 20,
  stiffness: 200,
  mass: 0.6,
} as const;

/** Spring config for urgency pulse animation */
export const URGENCY_PULSE_SPRING = {
  damping: 6,
  stiffness: 80,
  mass: 1,
} as const;

/** Duration for pin entrance animation target (ms) */
export const PIN_ENTRANCE_DURATION_MS = 300;

/** Duration for pin exit animation target (ms) */
export const PIN_EXIT_DURATION_MS = 250;

// ─── Cleaner Marker Animation ────────────────────────────────────────────────

/** Pulsing ring animation config for the Cleaner's self-position marker */
export const CLEANER_PULSE_CONFIG = {
  /** Minimum scale of the pulse ring */
  minScale: 1.0,
  /** Maximum scale of the pulse ring */
  maxScale: 1.8,
  /** Duration of one pulse cycle (ms) */
  durationMs: 2000,
  /** Opacity at maximum scale */
  minOpacity: 0.0,
  /** Opacity at minimum scale */
  maxOpacity: 0.4,
} as const;

// ─── Service Type Icon Mapping ───────────────────────────────────────────────

/**
 * Maps service types to custom icon asset names used in Mapbox SymbolLayer.
 * Icons are loaded as Mapbox image assets at map initialization.
 */
export const SERVICE_TYPE_ICONS: Record<ServiceType, string> = {
  standard: 'pin-standard',
  deep: 'pin-deep',
  move_in_out: 'pin-move',
  post_construction: 'pin-construction',
  post_event: 'pin-event',
  recurring: 'pin-recurring',
} as const;

/** i18n label keys for service type filter chips */
export const SERVICE_TYPE_LABEL_KEYS: Record<ServiceType, string> = {
  standard: 'radar.filter.serviceType.standard',
  deep: 'radar.filter.serviceType.deep',
  move_in_out: 'radar.filter.serviceType.moveInOut',
  post_construction: 'radar.filter.serviceType.postConstruction',
  post_event: 'radar.filter.serviceType.postEvent',
  recurring: 'radar.filter.serviceType.recurring',
} as const;

// ─── Pin Colors ──────────────────────────────────────────────────────────────

export const PIN_COLORS = {
  /** Default pin color (active, not urgent) */
  normal: '#FFFFFF',
  /** Urgent offer pin color (scheduled within 2 hours) */
  urgent: '#00F5D4',
  /** Viewed offer pin — reduced opacity applied via Mapbox expressions */
  viewedOpacity: 0.6,
  /** Stale/cached offer pin — further reduced opacity */
  staleOpacity: 0.5,
} as const;

// ─── Pagination ──────────────────────────────────────────────────────────────

/** Default page size for available offers endpoint */
export const RADAR_PAGE_SIZE = Number(
  process.env.EXPO_PUBLIC_RADAR_PAGE_SIZE ?? '20',
);

/** Maximum page size allowed by the API */
export const RADAR_MAX_PAGE_SIZE = 50;

// ─── Ad Slot ─────────────────────────────────────────────────────────────────

/** Ad slot insertion interval in list view (every Nth position, 0-indexed) */
export const AD_SLOT_INTERVAL = 5;

/** First ad slot position (0-indexed) */
export const AD_SLOT_FIRST_POSITION = 4;

// ─── Map Defaults ────────────────────────────────────────────────────────────

/** Default map zoom level on initial load */
export const MAP_DEFAULT_ZOOM = 13;

/** Minimum zoom level (zoomed out) */
export const MAP_MIN_ZOOM = 8;

/** Maximum zoom level (zoomed in) */
export const MAP_MAX_ZOOM = 18;

/** Map animation duration for flyTo transitions (ms) */
export const MAP_FLY_TO_DURATION_MS = 800;

// ─── Snapshot Rate Limiting ──────────────────────────────────────────────────

/** Minimum interval between snapshot requests (client-side guard, ms) */
export const SNAPSHOT_MIN_INTERVAL_MS = 30_000;
