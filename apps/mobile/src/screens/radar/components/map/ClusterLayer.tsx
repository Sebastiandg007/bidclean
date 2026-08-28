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

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Renders the cluster circle + count layers. Cluster tap handling lives in
 * `OfferPinsLayer` (via the shared ShapeSource `onPress`), so this component
 * takes no props.
 */
export const ClusterLayer: React.FC = React.memo(() => {
  return (
    <>
      {/* Cluster circle background */}
      <MapboxGL.CircleLayer
        id={LAYER_IDS.CLUSTER_CIRCLES}
        sourceID={SOURCE_IDS.OFFERS}
        filter={clusterFilter}
        style={clusterCircleStyle}
      />

      {/* Cluster count text label */}
      <MapboxGL.SymbolLayer
        id={LAYER_IDS.CLUSTER_COUNT}
        sourceID={SOURCE_IDS.OFFERS}
        filter={clusterFilter}
        style={clusterCountStyle}
      />
    </>
  );
});

ClusterLayer.displayName = 'ClusterLayer';
