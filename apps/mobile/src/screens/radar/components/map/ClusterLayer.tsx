/**
 * ClusterLayer — Renders clustered offer points as circles with count badges.
 *
 * Uses:
 * - CircleLayer for cluster background circles (size/color scale with point count)
 * - SymbolLayer for the numeric count label centered on each cluster
 *
 * Cluster styling is data-driven via Mapbox expressions defined in mapStyles.ts.
 * Only renders features that ARE clusters (filtered by `clusterFilter`).
 *
 * Requirements: 1.6, 1.7
 */

import React from 'react';
import MapboxGL from '@rnmapbox/maps';

import { LAYER_IDS, SOURCE_IDS } from '../../radar.constants';
import {
  clusterCircleStyle,
  clusterCountStyle,
  clusterFilter,
} from './mapStyles';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ClusterLayerProps {
  /** Callback when a cluster circle is tapped (zoom to expand) */
  onClusterPress?: (feature: GeoJSON.Feature, clusterCenter: [number, number]) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const ClusterLayer: React.FC<ClusterLayerProps> = React.memo(
  ({ onClusterPress }) => {
    return (
      <>
        {/* Cluster circle background */}
        <MapboxGL.CircleLayer
          id={LAYER_IDS.CLUSTER_CIRCLES}
          sourceID={SOURCE_IDS.OFFERS}
          filter={clusterFilter}
          style={clusterCircleStyle}
          testID="cluster-circles-layer"
        />

        {/* Cluster count text label */}
        <MapboxGL.SymbolLayer
          id={LAYER_IDS.CLUSTER_COUNT}
          sourceID={SOURCE_IDS.OFFERS}
          filter={clusterFilter}
          style={clusterCountStyle}
          testID="cluster-count-layer"
        />
      </>
    );
  },
);

ClusterLayer.displayName = 'ClusterLayer';
