/**
 * Mapbox style expressions for the Radar map layers.
 *
 * Defines data-driven styling using Mapbox GL expression syntax
 * compatible with @rnmapbox/maps. All expressions reference
 * GeoJSON feature properties from the OfferFeatureProperties interface.
 *
 * Layers styled:
 * - SymbolLayer (offer pins): icon, color, opacity, text label
 * - CircleLayer (clusters): size, color, text count
 * - CircleLayer (work zone): fill, border
 */

import type { Expression } from '@rnmapbox/maps';

import {
  CLUSTER_CONFIG,
  PIN_COLORS,
  SERVICE_TYPE_ICONS,
} from '../../radar.constants';

// ─── Icon Image Mapping ──────────────────────────────────────────────────────

/**
 * Mapbox `match` expression that maps the `serviceType` feature property
 * to the corresponding pin icon asset name.
 *
 * Usage: `iconImage` property on SymbolLayer style.
 */
export const iconImageExpression: Expression = [
  'match',
  ['get', 'serviceType'],
  'standard',
  SERVICE_TYPE_ICONS.standard,
  'deep',
  SERVICE_TYPE_ICONS.deep,
  'move_in_out',
  SERVICE_TYPE_ICONS.move_in_out,
  'post_construction',
  SERVICE_TYPE_ICONS.post_construction,
  'post_event',
  SERVICE_TYPE_ICONS.post_event,
  'recurring',
  SERVICE_TYPE_ICONS.recurring,
  // Fallback for unknown service types
  SERVICE_TYPE_ICONS.standard,
];

// ─── Pin Color Expressions ───────────────────────────────────────────────────

/**
 * Data-driven color expression for offer pin icons.
 * Priority: urgent (accent mint) > normal (white).
 *
 * Usage: `iconColor` property on SymbolLayer style.
 */
export const pinColorExpression: Expression = [
  'case',
  ['get', 'isUrgent'],
  PIN_COLORS.urgent,
  PIN_COLORS.normal,
];

/**
 * Data-driven text color for the price label on pins.
 * Uses the same logic as pin color for visual consistency.
 */
export const pinTextColorExpression: Expression = [
  'case',
  ['get', 'isUrgent'],
  PIN_COLORS.urgent,
  PIN_COLORS.normal,
];

// ─── Pin Opacity Expressions ─────────────────────────────────────────────────

/**
 * Data-driven opacity expression for offer pins.
 * Priority: stale (lowest) > viewed (reduced) > normal (full).
 *
 * Usage: `iconOpacity` and `textOpacity` on SymbolLayer style.
 */
export const pinOpacityExpression: Expression = [
  'case',
  ['get', 'isStale'],
  PIN_COLORS.staleOpacity,
  ['get', 'isViewed'],
  PIN_COLORS.viewedOpacity,
  1.0,
];

// ─── Price Label Formatting ──────────────────────────────────────────────────

/**
 * Text field expression that formats `payoutCents` as a dollar value.
 * Divides cents by 100 and prepends "$" symbol.
 *
 * Example: payoutCents = 4500 → "$45"
 *
 * Usage: `textField` property on SymbolLayer style.
 */
export const priceLabelExpression: Expression = [
  'concat',
  '$',
  ['to-string', ['/', ['get', 'payoutCents'], 100]],
];

// ─── Cluster Circle Styling ──────────────────────────────────────────────────

/**
 * Step expression for cluster circle radius.
 * Scales proportionally to the number of points in the cluster.
 *
 * Usage: `circleRadius` property on CircleLayer for clusters.
 */
export const clusterRadiusExpression: Expression = [
  'step',
  ['get', 'point_count'],
  15, // base radius for smallest clusters
  10,
  20, // 10+ points → radius 20
  25,
  25, // 25+ points → radius 25
  50,
  30, // 50+ points → radius 30
  100,
  35, // 100+ points → radius 35
];

/**
 * Interpolation expression for cluster circle color.
 * Shifts from a muted tone to the accent color as cluster size grows.
 *
 * Usage: `circleColor` property on CircleLayer for clusters.
 */
export const clusterColorExpression: Expression = [
  'step',
  ['get', 'point_count'],
  '#1F2833', // small clusters: card background
  10,
  '#1F3844', // medium clusters: slightly brighter
  25,
  '#1F4844', // larger clusters: trending toward accent
  50,
  '#0A7B6A', // large clusters: close to accent
  100,
  PIN_COLORS.urgent, // very large: full accent color
];

/**
 * Cluster circle border/stroke color — always accent for visibility.
 */
export const CLUSTER_STROKE_COLOR = PIN_COLORS.urgent;

/**
 * Cluster circle stroke width (pixels).
 */
export const CLUSTER_STROKE_WIDTH = 2;

/**
 * Cluster circle opacity.
 */
export const CLUSTER_OPACITY = 0.85;

/**
 * Cluster count text color — white for readability on dark circles.
 */
export const CLUSTER_TEXT_COLOR = '#FFFFFF';

/**
 * Cluster count text size.
 */
export const CLUSTER_TEXT_SIZE = 14;

// ─── Work Zone Circle Styling ────────────────────────────────────────────────

/** Semi-transparent fill for the work zone area */
export const WORK_ZONE_FILL_COLOR = 'rgba(0, 245, 212, 0.06)';

/** Border color for the work zone circle */
export const WORK_ZONE_BORDER_COLOR = 'rgba(0, 245, 212, 0.3)';

/** Border width for the work zone circle (pixels) */
export const WORK_ZONE_BORDER_WIDTH = 1.5;

// ─── Symbol Layer Style Objects ──────────────────────────────────────────────

/**
 * Complete style object for the offer pins SymbolLayer.
 * Combines icon, text, and layout properties.
 *
 * Usage: spread into SymbolLayer `style` prop.
 */
export const offerPinStyle = {
  iconImage: iconImageExpression,
  iconColor: pinColorExpression,
  iconOpacity: pinOpacityExpression,
  iconSize: 1.0,
  iconAllowOverlap: false,
  iconAnchor: 'bottom' as const,

  // Price label
  textField: priceLabelExpression,
  textColor: pinTextColorExpression,
  textOpacity: pinOpacityExpression,
  textSize: 11,
  textFont: ['literal', ['DIN Pro Medium', 'Arial Unicode MS Regular']],
  textAnchor: 'top' as const,
  textOffset: [0, 0.5] as [number, number],
  textAllowOverlap: false,
  textHaloColor: '#0B0C10',
  textHaloWidth: 1,
} as const;

/**
 * Complete style object for the cluster circles CircleLayer.
 *
 * Usage: spread into CircleLayer `style` prop.
 */
export const clusterCircleStyle = {
  circleRadius: clusterRadiusExpression,
  circleColor: clusterColorExpression,
  circleOpacity: CLUSTER_OPACITY,
  circleStrokeColor: CLUSTER_STROKE_COLOR,
  circleStrokeWidth: CLUSTER_STROKE_WIDTH,
} as const;

/**
 * Style for the cluster count text (rendered as a SymbolLayer above cluster circles).
 *
 * Usage: spread into SymbolLayer `style` prop for cluster count.
 */
export const clusterCountStyle = {
  textField: ['to-string', ['get', 'point_count']] as Expression,
  textColor: CLUSTER_TEXT_COLOR,
  textSize: CLUSTER_TEXT_SIZE,
  textFont: ['literal', ['DIN Pro Bold', 'Arial Unicode MS Bold']],
  textAllowOverlap: true,
} as const;

/**
 * Style for the work zone fill layer (FillLayer).
 *
 * Usage: spread into FillLayer `style` prop.
 */
export const workZoneFillStyle = {
  fillColor: WORK_ZONE_FILL_COLOR,
  fillOpacity: 1,
} as const;

/**
 * Style for the work zone border layer (LineLayer).
 *
 * Usage: spread into LineLayer `style` prop.
 */
export const workZoneBorderStyle = {
  lineColor: WORK_ZONE_BORDER_COLOR,
  lineWidth: WORK_ZONE_BORDER_WIDTH,
  lineDasharray: [2, 2] as [number, number],
} as const;

// ─── Cluster Filter Expressions ──────────────────────────────────────────────

/**
 * Filter expression for clustered points (used on cluster layers).
 * Shows only features that ARE clusters.
 */
export const clusterFilter: Expression = ['has', 'point_count'];

/**
 * Filter expression for unclustered points (used on pin layer).
 * Shows only features that are NOT clusters.
 */
export const unclusteredFilter: Expression = ['!', ['has', 'point_count']];

// ─── Cluster Source Configuration ────────────────────────────────────────────

/**
 * Configuration object for the ShapeSource that enables clustering.
 * Passed as props to the @rnmapbox/maps ShapeSource component.
 */
export const clusterSourceConfig = {
  cluster: true,
  clusterRadius: CLUSTER_CONFIG.CLUSTER_RADIUS,
  clusterMaxZoomLevel: CLUSTER_CONFIG.CLUSTER_MAX_ZOOM,
  clusterProperties: {
    urgentCount: [
      ['+', ['accumulated'], ['get', 'urgentCount']],
      ['case', ['get', 'isUrgent'], 1, 0],
    ],
  },
} as const;
