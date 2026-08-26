/**
 * OfferPinsLayer — Native Mapbox SymbolLayer for rendering offer pins.
 *
 * Uses ShapeSource with clustering enabled to feed both:
 * - This SymbolLayer (unclustered individual pins)
 * - ClusterLayer (clustered circle aggregates)
 *
 * GeoJSON data is derived reactively from the Zustand store via
 * `getOffersAsGeoJSON()`. Pin styling (icon, color, opacity, text)
 * is fully data-driven through Mapbox expressions in mapStyles.ts.
 *
 * This component does NOT use React Native `<Marker />` components —
 * native symbol layers ensure 60fps with 200+ pins.
 *
 * Requirements: 1.6, 2.1, 2.3, 2.4, 2.5, 2.8, 12.3
 */

import React, { useCallback } from 'react';
import MapboxGL from '@rnmapbox/maps';

import { useRadarStore } from '../../useRadarStore';
import {
  SOURCE_IDS,
  LAYER_IDS,
  CLUSTER_TAP_ZOOM_INCREMENT,
} from '../../radar.constants';
import {
  offerPinStyle,
  unclusteredFilter,
  clusterSourceConfig,
} from './mapStyles';
import { ClusterLayer } from './ClusterLayer';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface OfferPinsLayerProps {
  /** Callback when an individual (unclustered) pin is tapped */
  onPinPress: (offerId: string) => void;
  /** Callback to fly camera to a position with increased zoom (cluster expand) */
  onClusterPress: (center: [number, number], zoomIncrement: number) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const OfferPinsLayer: React.FC<OfferPinsLayerProps> = React.memo(
  ({ onPinPress, onClusterPress }) => {
    const geoJSON = useRadarStore((state) => state.getOffersAsGeoJSON());

    const handlePress = useCallback(
      (event: MapboxGL.OnPressEvent) => {
        const feature = event.features?.[0];
        if (!feature) return;

        const properties = feature.properties;

        // Cluster tap → zoom to expand
        if (properties?.cluster === true || properties?.point_count) {
          const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
          onClusterPress(coordinates, CLUSTER_TAP_ZOOM_INCREMENT);
          return;
        }

        // Individual pin tap → select offer
        const offerId = properties?.offerId;
        if (offerId && typeof offerId === 'string') {
          onPinPress(offerId);
        }
      },
      [onPinPress, onClusterPress],
    );

    return (
      <MapboxGL.ShapeSource
        id={SOURCE_IDS.OFFERS}
        shape={geoJSON}
        cluster={clusterSourceConfig.cluster}
        clusterRadius={clusterSourceConfig.clusterRadius}
        clusterMaxZoomLevel={clusterSourceConfig.clusterMaxZoomLevel}
        clusterProperties={clusterSourceConfig.clusterProperties}
        onPress={handlePress}
        testID="offers-shape-source"
      >
        {/* Individual (unclustered) offer pins */}
        <MapboxGL.SymbolLayer
          id={LAYER_IDS.OFFER_PINS}
          filter={unclusteredFilter}
          style={offerPinStyle}
          testID="offer-pins-layer"
        />

        {/* Cluster circles + count (rendered above pins) */}
        <ClusterLayer />
      </MapboxGL.ShapeSource>
    );
  },
);

OfferPinsLayer.displayName = 'OfferPinsLayer';
