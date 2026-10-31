/**
 * TrackingScreen (Host) — watch the Cleaner approach in real time (Spec 17).
 *
 * Composes the tracking store with the read-only `useTrackingChannel` hook and a Mapbox map that
 * RENDERS the Cleaner's live position + the destination. Mapbox is never the source of truth for
 * position or arrival (that is Centrifugo transport + the server geofence). Shows the current state
 * ("on the way / arrived / started"), a clear "Cleaner has arrived" indication on `ARRIVED`, and a
 * "location unavailable" state rather than a stale position when no live frame has arrived. All copy
 * comes from i18n; dark BidClean tokens.
 */

import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import MapboxGL from '@rnmapbox/maps';

import { MAP_DEFAULT_ZOOM, TRACKING_COLORS, TRACKING_I18N_KEYS } from './tracking.constants';
import { stateLabelKey } from './tracking.labels';
import { useTrackingStore } from './tracking.store';
import { useTrackingChannel } from './useTrackingChannel';

export interface TrackingScreenProps {
  route: { params: { sessionId: string } };
  navigation: { goBack: () => void };
}

export function TrackingScreen({ route }: TrackingScreenProps): React.JSX.Element {
  const { sessionId } = route.params;
  const { t } = useTranslation();

  const session = useTrackingStore((store) => store.session);
  const livePosition = useTrackingStore((store) => store.livePosition);
  const loadSession = useTrackingStore((store) => store.loadSession);
  const onLivePosition = useTrackingStore((store) => store.onLivePosition);
  const onStateSignal = useTrackingStore((store) => store.onStateSignal);
  const reconcile = useTrackingStore((store) => store.reconcile);
  const setConnectionStatus = useTrackingStore((store) => store.setConnectionStatus);

  useEffect(() => {
    void loadSession(sessionId);
  }, [sessionId, loadSession]);

  useTrackingChannel({
    sessionId,
    onLivePosition,
    onStateSignal,
    onConnectionChange: setConnectionStatus,
    onReconcile: reconcile,
  });

  const destination = session?.propertyLocation ?? null;
  const isArrived = session?.state === 'ARRIVED';
  const hasLivePosition = livePosition !== null;

  return (
    <SafeAreaView style={styles.screen} testID="tracking-screen">
      <Text style={styles.title}>{t(TRACKING_I18N_KEYS.TRACKING_TITLE)}</Text>
      <Text style={styles.stateLabel} testID="tracking-state">
        {t(stateLabelKey(session?.state ?? null))}
      </Text>

      {isArrived && (
        <Text style={styles.arrived} testID="tracking-arrived">
          {t(TRACKING_I18N_KEYS.CLEANER_ARRIVED)}
        </Text>
      )}

      {!hasLivePosition && !isArrived && (
        <Text style={styles.unavailable} testID="tracking-location-unavailable">
          {t(TRACKING_I18N_KEYS.LOCATION_UNAVAILABLE)}
        </Text>
      )}

      <View style={styles.mapContainer} testID="tracking-map">
        {destination !== null && (
          <MapboxGL.MapView style={styles.map} scaleBarEnabled={false}>
            <MapboxGL.Camera
              zoomLevel={MAP_DEFAULT_ZOOM}
              centerCoordinate={[destination.lng, destination.lat]}
            />
            <MapboxGL.PointAnnotation
              id="tracking-destination"
              coordinate={[destination.lng, destination.lat]}
            >
              <View style={styles.destinationMarker} />
            </MapboxGL.PointAnnotation>
            {livePosition !== null && (
              <MapboxGL.PointAnnotation
                id="tracking-cleaner"
                coordinate={[livePosition.lng, livePosition.lat]}
              >
                <View style={styles.cleanerMarker} />
              </MapboxGL.PointAnnotation>
            )}
          </MapboxGL.MapView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: TRACKING_COLORS.BACKGROUND, padding: 16 },
  title: { color: TRACKING_COLORS.TEXT, fontSize: 24, fontWeight: '700', marginBottom: 12 },
  stateLabel: { color: TRACKING_COLORS.ACCENT, fontSize: 16, marginBottom: 8 },
  arrived: { color: TRACKING_COLORS.ACCENT, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  unavailable: { color: 'rgba(255,255,255,0.6)', fontSize: 14, marginBottom: 8 },
  mapContainer: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: TRACKING_COLORS.CARD,
    marginTop: 12,
  },
  map: { flex: 1 },
  destinationMarker: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: TRACKING_COLORS.TEXT,
    backgroundColor: TRACKING_COLORS.CARD,
  },
  cleanerMarker: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: TRACKING_COLORS.ACCENT,
  },
});
