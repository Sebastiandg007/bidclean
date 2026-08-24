/**
 * PropertyMap
 *
 * Mapbox MapView with draggable pin for property location selection.
 * Supports tap-to-place pin and triggers reverse geocoding on pin move.
 * Works as fallback when forward geocoding fails — the user can place
 * the pin manually on the map to set the property location.
 *
 * Features:
 * - Dark-styled Mapbox map
 * - Draggable marker pin (when editable)
 * - Tap-to-place pin on map press (when editable)
 * - Reverse geocoding on pin placement/move (debounced on drag end)
 * - Loading indicator while reverse geocoding
 * - Fallback message when geocoding fails
 * - View-only mode (editable=false) for detail screens
 *
 * @example
 * ```tsx
 * <PropertyMap
 *   coordinates={{ latitude: 4.711, longitude: -74.0721 }}
 *   onLocationChange={(coords) => setCoords(coords)}
 *   onReverseGeocodeResult={(result) => updateAddress(result)}
 *   editable
 *   showFallbackMessage
 * />
 * ```
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import MapboxGL from '@rnmapbox/maps';

import {
  COLORS,
  DEFAULT_MAP_CENTER_LAT,
  DEFAULT_MAP_CENTER_LNG,
  DEFAULT_MAP_ZOOM,
  FONT_SIZE,
  SPACING,
} from '../properties.constants';
import type { Coordinates, ReverseGeocodeResponse } from '../properties.types';
import { usePropertiesStore } from '../useProperties';

// ─── Configuration ───────────────────────────────────────────────────────────

/** Mapbox public access token for map display (configured at app level) */
const MAPBOX_ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '';

/** Dark map style URL for Mapbox (project standard dark style) */
const DARK_MAP_STYLE = 'mapbox://styles/mapbox/dark-v11';

// ─── Layout Constants ────────────────────────────────────────────────────────

const MAP_MIN_HEIGHT = 240;
const MAP_BORDER_RADIUS = 12;
const PIN_HEAD_SIZE = 24;
const PIN_HEAD_BORDER_WIDTH = 3;
const PIN_NEEDLE_WIDTH = 3;
const PIN_NEEDLE_HEIGHT = 12;
const ANIMATION_DURATION_MS = 300;
const LOADING_OVERLAY_OPACITY = 0.92;

// Initialize Mapbox with public token
MapboxGL.setAccessToken(MAPBOX_ACCESS_TOKEN);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PropertyMapProps {
  /** Current pin coordinates (if any) */
  coordinates?: Coordinates;
  /** Callback when the pin is placed or moved */
  onLocationChange?: (coordinates: Coordinates) => void;
  /** Callback with reverse geocoding result after pin move */
  onReverseGeocodeResult?: (result: ReverseGeocodeResponse) => void;
  /** Whether the map is interactive (pin draggable, tap-to-place) */
  editable?: boolean;
  /** Show fallback message when geocoding failed */
  showFallbackMessage?: boolean;
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

interface MapPinProps {
  coordinate: [number, number];
  draggable: boolean;
  onDragEnd: (event: { geometry: { coordinates: [number, number] } }) => void;
}

/** Custom map pin marker with accent color */
function MapPin({ coordinate, draggable, onDragEnd }: MapPinProps) {
  return (
    <MapboxGL.PointAnnotation
      id="property-pin"
      coordinate={coordinate}
      draggable={draggable}
      onDragEnd={onDragEnd}
      testID="property-map-pin"
    >
      <View style={styles.pinContainer}>
        <View style={styles.pinHead} />
        <View style={styles.pinNeedle} />
      </View>
    </MapboxGL.PointAnnotation>
  );
}

interface FallbackMessageBannerProps {
  visible: boolean;
}

/** Banner shown when geocoding fails, prompting manual pin placement */
function FallbackMessageBanner({ visible }: FallbackMessageBannerProps) {
  const { t } = useTranslation();

  if (!visible) return null;

  return (
    <View
      style={styles.fallbackBanner}
      accessibilityRole="alert"
      testID="property-map-fallback-banner"
    >
      <Text style={styles.fallbackText}>
        {t('properties.map.fallback_message', {
          defaultValue: 'Tap on the map to place the pin manually.',
        })}
      </Text>
    </View>
  );
}

interface GeocodingLoadingOverlayProps {
  isLoading: boolean;
}

/** Overlay shown while reverse geocoding is in progress */
function GeocodingLoadingOverlay({ isLoading }: GeocodingLoadingOverlayProps) {
  const { t } = useTranslation();

  if (!isLoading) return null;

  return (
    <View
      style={styles.loadingOverlay}
      accessibilityRole="progressbar"
      accessibilityLabel={t('properties.map.loading_a11y', {
        defaultValue: 'Resolving address from pin location',
      })}
      testID="property-map-loading-overlay"
    >
      <ActivityIndicator size="small" color={COLORS.accent} />
      <Text style={styles.loadingText}>
        {t('properties.map.resolving_address', {
          defaultValue: 'Resolving address...',
        })}
      </Text>
    </View>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

/**
 * Renders a Mapbox map with an interactive pin for property location selection.
 *
 * When `editable` is true, users can:
 * - Drag the pin to reposition it
 * - Tap anywhere on the map to place/move the pin
 *
 * After pin placement, reverse geocoding is triggered to resolve the address.
 *
 * @param coordinates - Current pin location
 * @param onLocationChange - Called with new coordinates when pin moves
 * @param onReverseGeocodeResult - Called with reverse geocoding result
 * @param editable - Enable pin interaction (drag + tap-to-place)
 * @param showFallbackMessage - Show "place pin manually" hint
 */
export const PropertyMap: React.FC<PropertyMapProps> = ({
  coordinates,
  onLocationChange,
  onReverseGeocodeResult,
  editable = false,
  showFallbackMessage = false,
}) => {
  const { t } = useTranslation();
  const [isReverseGeocoding, setIsReverseGeocoding] = useState(false);
  const cameraRef = useRef<MapboxGL.Camera>(null);
  const reverseGeocode = usePropertiesStore((state) => state.reverseGeocode);

  // Determine map center: use provided coordinates or default (Bogotá)
  const centerLongitude = coordinates?.longitude ?? DEFAULT_MAP_CENTER_LNG;
  const centerLatitude = coordinates?.latitude ?? DEFAULT_MAP_CENTER_LAT;

  // Pin coordinates in [lng, lat] format for Mapbox
  const pinCoordinate: [number, number] | null = coordinates
    ? [coordinates.longitude, coordinates.latitude]
    : null;

  /**
   * Performs reverse geocoding for the given coordinates.
   * Calls onLocationChange and onReverseGeocodeResult callbacks.
   */
  const handlePinPlacement = useCallback(
    async (newCoordinates: Coordinates) => {
      onLocationChange?.(newCoordinates);

      setIsReverseGeocoding(true);
      try {
        const result = await reverseGeocode({
          latitude: newCoordinates.latitude,
          longitude: newCoordinates.longitude,
        });

        if (result) {
          onReverseGeocodeResult?.(result);
        }
      } finally {
        setIsReverseGeocoding(false);
      }
    },
    [onLocationChange, onReverseGeocodeResult, reverseGeocode],
  );

  /** Handle pin drag end — triggers reverse geocoding */
  const handleDragEnd = useCallback(
    (event: { geometry: { coordinates: [number, number] } }) => {
      const [longitude, latitude] = event.geometry.coordinates;
      const newCoordinates: Coordinates = { latitude, longitude };
      void handlePinPlacement(newCoordinates);
    },
    [handlePinPlacement],
  );

  /** Handle map press — place pin at tapped location (editable mode only) */
  const handleMapPress = useCallback(
    (feature: GeoJSON.Feature) => {
      if (!editable) return;

      const geometry = feature.geometry;
      if (geometry.type !== 'Point') return;

      const [longitude, latitude] = geometry.coordinates;
      const newCoordinates: Coordinates = { latitude, longitude };
      void handlePinPlacement(newCoordinates);
    },
    [editable, handlePinPlacement],
  );

  return (
    <View
      style={styles.container}
      accessibilityRole="none"
      accessibilityLabel={t('properties.map.container_a11y', {
        defaultValue: 'Property location map',
      })}
      testID="property-map"
    >
      <View style={styles.mapWrapper}>
        <MapboxGL.MapView
          style={styles.map}
          styleURL={DARK_MAP_STYLE}
          onPress={editable ? handleMapPress : undefined}
          scrollEnabled={editable}
          pitchEnabled={false}
          rotateEnabled={false}
          zoomEnabled={editable}
          attributionEnabled={false}
          logoEnabled={false}
          testID="property-map-view"
        >
          <MapboxGL.Camera
            ref={cameraRef}
            centerCoordinate={[centerLongitude, centerLatitude]}
            zoomLevel={DEFAULT_MAP_ZOOM}
            animationMode="flyTo"
            animationDuration={ANIMATION_DURATION_MS}
          />

          {pinCoordinate && (
            <MapPin
              coordinate={pinCoordinate}
              draggable={editable}
              onDragEnd={handleDragEnd}
            />
          )}
        </MapboxGL.MapView>

        <GeocodingLoadingOverlay isLoading={isReverseGeocoding} />
      </View>

      <FallbackMessageBanner visible={showFallbackMessage && editable} />
    </View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    gap: SPACING.sm,
  },
  mapWrapper: {
    borderRadius: MAP_BORDER_RADIUS,
    overflow: 'hidden',
    minHeight: MAP_MIN_HEIGHT,
    backgroundColor: COLORS.card,
  },
  map: {
    flex: 1,
    minHeight: MAP_MIN_HEIGHT,
  },
  pinContainer: {
    alignItems: 'center',
  },
  pinHead: {
    width: PIN_HEAD_SIZE,
    height: PIN_HEAD_SIZE,
    borderRadius: PIN_HEAD_SIZE / 2,
    backgroundColor: COLORS.accent,
    borderWidth: PIN_HEAD_BORDER_WIDTH,
    borderColor: COLORS.textPrimary,
  },
  pinNeedle: {
    width: PIN_NEEDLE_WIDTH,
    height: PIN_NEEDLE_HEIGHT,
    backgroundColor: COLORS.accent,
    borderBottomLeftRadius: PIN_NEEDLE_WIDTH,
    borderBottomRightRadius: PIN_NEEDLE_WIDTH,
  },
  loadingOverlay: {
    position: 'absolute',
    bottom: SPACING.sm,
    left: SPACING.sm,
    right: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: `rgba(31, 40, 51, ${LOADING_OVERLAY_OPACITY})`,
    borderRadius: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  loadingText: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.caption,
    fontWeight: '500',
  },
  fallbackBanner: {
    backgroundColor: COLORS.accentSubtle,
    borderRadius: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.accent,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  fallbackText: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.subtitle,
    fontWeight: '500',
    textAlign: 'center',
  },
});

export default PropertyMap;
