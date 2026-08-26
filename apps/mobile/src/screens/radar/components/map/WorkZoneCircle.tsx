/**
 * WorkZoneCircle — Semi-transparent circle overlay representing
 * the Cleaner's configured work zone radius on the Radar map.
 *
 * Renders a GeoJSON polygon (approximated circle) using:
 * - FillLayer for the translucent interior
 * - LineLayer for the dashed border
 *
 * Props:
 * - center: work zone center point (from cleaner_profiles, NOT GPS)
 * - radiusMeters: work zone radius (from cleaner_profiles.work_radius_meters)
 *
 * Requirements: 1.4, 10.1
 */

import React, { useMemo } from 'react';
import MapboxGL from '@rnmapbox/maps';

import type { GeoPoint } from '../../radar.types';
import { SOURCE_IDS, LAYER_IDS } from '../../radar.constants';
import { workZoneFillStyle, workZoneBorderStyle } from './mapStyles';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Number of vertices to approximate the circle polygon */
const CIRCLE_SEGMENTS = 64;

/** Approximate meters per degree of latitude */
const METERS_PER_DEGREE_LAT = 111_320;

// ─── Props ───────────────────────────────────────────────────────────────────

export interface WorkZoneCircleProps {
  /** Work zone center point (from cleaner_profiles) */
  center: GeoPoint;
  /** Work zone radius in meters */
  radiusMeters: number;
}

// ─── GeoJSON Circle Generator ────────────────────────────────────────────────

/**
 * Generates a GeoJSON Polygon approximating a circle on the Earth's surface.
 * Uses a simple equirectangular projection correction for longitude scaling.
 */
function generateCircleGeoJSON(
  center: GeoPoint,
  radiusMeters: number,
  segments: number,
): GeoJSON.FeatureCollection {
  const { lat, lng } = center;

  // Longitude degrees per meter at this latitude
  const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);

  const radiusLat = radiusMeters / METERS_PER_DEGREE_LAT;
  const radiusLng = radiusMeters / metersPerDegreeLng;

  const coordinates: [number, number][] = [];

  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    const pointLng = lng + radiusLng * Math.cos(angle);
    const pointLat = lat + radiusLat * Math.sin(angle);
    coordinates.push([pointLng, pointLat]);
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [coordinates],
        },
        properties: {},
      },
    ],
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

export const WorkZoneCircle: React.FC<WorkZoneCircleProps> = React.memo(
  ({ center, radiusMeters }) => {
    const circleGeoJSON = useMemo(
      () => generateCircleGeoJSON(center, radiusMeters, CIRCLE_SEGMENTS),
      [center.lat, center.lng, radiusMeters],
    );

    return (
      <MapboxGL.ShapeSource
        id={SOURCE_IDS.WORK_ZONE}
        shape={circleGeoJSON}
        testID="work-zone-source"
      >
        <MapboxGL.FillLayer
          id={LAYER_IDS.WORK_ZONE_FILL}
          style={workZoneFillStyle}
          testID="work-zone-fill-layer"
        />
        <MapboxGL.LineLayer
          id={LAYER_IDS.WORK_ZONE_BORDER}
          style={workZoneBorderStyle}
          testID="work-zone-border-layer"
        />
      </MapboxGL.ShapeSource>
    );
  },
);

WorkZoneCircle.displayName = 'WorkZoneCircle';
