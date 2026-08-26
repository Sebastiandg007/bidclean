/**
 * RadarMapView — Main map container for the Cleaner's Offer Radar.
 *
 * Composes all map sub-layers in correct rendering order:
 * 1. Base map (Mapbox dark/light style)
 * 2. WorkZoneCircle (semi-transparent radius ring)
 * 3. OfferPinsLayer (clustered symbol layer for offers)
 * 4. CleanerMarker (animated self-position)
 *
 * Responsibilities:
 * - Configure Mapbox MapView with BidClean custom style (dark/light)
 * - Initial camera position centered on Cleaner's GPS
 * - Handle pin tap → select offer (opens OfferPreviewSheet via store)
 * - Handle cluster tap → zoom to expand (flyTo with +2 zoom)
 * - Standard gestures: pinch-to-zoom, pan, rotate, double-tap
 *
 * Requirements: 1.1, 1.2, 1.5, 1.7, 1.8
 */

import React, { useCallback, useRef } from 'react';
import { StyleSheet } from 'react-native';
import MapboxGL from '@rnmapbox/maps';

import type { GeoPoint } from '../../radar.types';
import { useRadarStore } from '../../useRadarStore';
import {
  MAP_DEFAULT_ZOOM,
  MAP_MIN_ZOOM,
  MAP_MAX_ZOOM,
  MAP_FLY_TO_DURATION_MS,
} from '../../radar.constants';
import { OfferPinsLayer } from './OfferPinsLayer';
import { WorkZoneCircle } from './WorkZoneCircle';
import { CleanerMarker } from './CleanerMarker';

// ─── Map Style URLs ──────────────────────────────────────────────────────────

const MAP_STYLE_DARK =
  process.env.EXPO_PUBLIC_MAPBOX_STYLE_DARK ?? 'mapbox://styles/mapbox/dark-v11';
const MAP_STYLE_LIGHT =
  process.env.EXPO_PUBLIC_MAPBOX_STYLE_LIGHT ?? 'mapbox://styles/mapbox/light-v11';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface RadarMapViewProps {
  /** Cleaner's current GPS location for map centering and marker */
  cleanerLocation: GeoPoint;
  /** Cleaner's configured work zone center (from profile, NOT GPS) */
  workZoneCenter: GeoPoint;
  /** Cleaner's work zone radius in meters */
  workZoneRadiusMeters: number;
  /** Whether the app is in dark mode (true) or light mode (false) */
  isDarkMode?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const RadarMapView: React.FC<RadarMapViewProps> = React.memo(
  ({
    cleanerLocation,
    workZoneCenter,
    workZoneRadiusMeters,
    isDarkMode = true,
  }) => {
    const cameraRef = useRef<MapboxGL.Camera>(null);
    const selectOffer = useRadarStore((state) => state.selectOffer);

    const mapStyleUrl = isDarkMode ? MAP_STYLE_DARK : MAP_STYLE_LIGHT;

    // ─── Pin Tap Handler ───────────────────────────────────────────────

    const handlePinPress = useCallback(
      (offerId: string) => {
        selectOffer(offerId);
      },
      [selectOffer],
    );

    // ─── Cluster Tap Handler ───────────────────────────────────────────

    const handleClusterPress = useCallback(
      (center: [number, number], zoomIncrement: number) => {
        cameraRef.current?.setCamera({
          centerCoordinate: center,
          zoomLevel: MAP_DEFAULT_ZOOM + zoomIncrement,
          animationDuration: MAP_FLY_TO_DURATION_MS,
          animationMode: 'flyTo',
        });
      },
      [],
    );

    return (
      <MapboxGL.MapView
        style={styles.map}
        styleURL={mapStyleUrl}
        rotateEnabled
        pitchEnabled={false}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled
        scaleBarEnabled={false}
        testID="radar-map-view"
      >
        {/* Camera — initial center on Cleaner GPS */}
        <MapboxGL.Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: [cleanerLocation.lng, cleanerLocation.lat],
            zoomLevel: MAP_DEFAULT_ZOOM,
          }}
          minZoomLevel={MAP_MIN_ZOOM}
          maxZoomLevel={MAP_MAX_ZOOM}
          animationMode="flyTo"
          animationDuration={MAP_FLY_TO_DURATION_MS}
          testID="radar-camera"
        />

        {/* Layer 1: Work zone radius ring (bottom-most overlay) */}
        <WorkZoneCircle
          center={workZoneCenter}
          radiusMeters={workZoneRadiusMeters}
        />

        {/* Layer 2: Offer pins + clusters (middle layers) */}
        <OfferPinsLayer
          onPinPress={handlePinPress}
          onClusterPress={handleClusterPress}
        />

        {/* Layer 3: Cleaner self-position marker (top-most overlay) */}
        <CleanerMarker location={cleanerLocation} />
      </MapboxGL.MapView>
    );
  },
);

RadarMapView.displayName = 'RadarMapView';

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
});
