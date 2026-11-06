/**
 * EnRouteScreen (Cleaner) — the Cleaner's view while heading to the property (Spec 17).
 *
 * Shows the destination + optional live ETA (shown, not durable), drives position reporting via
 * `usePositionReporter` (which POSTs to the backend — the Cleaner never publishes to the channel),
 * and exposes a "Start" affordance enabled ONLY when the session is `ARRIVED`. Location-permission
 * denial degrades gracefully with an i18n explanation (never crashes). Mapbox renders the
 * destination only; it is never the source of truth for position or arrival. Dark BidClean tokens.
 */

import React, { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { TRACKING_COLORS, TRACKING_I18N_KEYS } from './tracking.constants';
import { stateLabelKey } from './tracking.labels';
import { useTrackingStore } from './tracking.store';
import { usePositionReporter } from './usePositionReporter';

export interface EnRouteScreenProps {
  route: { params: { sessionId: string } };
  navigation: { goBack: () => void };
}

export function EnRouteScreen({ route }: EnRouteScreenProps): React.JSX.Element {
  const { sessionId } = route.params;
  const { t } = useTranslation();

  const session = useTrackingStore((store) => store.session);
  const loadSession = useTrackingStore((store) => store.loadSession);
  const startEnRoute = useTrackingStore((store) => store.startEnRoute);
  const markStarted = useTrackingStore((store) => store.markStarted);

  const state = session?.state ?? null;
  const { permissionStatus, requestPermission } = usePositionReporter({ sessionId, state });

  useEffect(() => {
    void loadSession(sessionId);
  }, [sessionId, loadSession]);

  const isArrived = state === 'ARRIVED';
  const isMatched = state === 'MATCHED';

  return (
    <SafeAreaView style={styles.screen} testID="enroute-screen">
      <Text style={styles.title}>{t(TRACKING_I18N_KEYS.EN_ROUTE_TITLE)}</Text>
      <Text style={styles.stateLabel} testID="enroute-state">
        {t(stateLabelKey(state))}
      </Text>

      {session?.propertyLocation !== null && session?.propertyLocation !== undefined && (
        <Text style={styles.destination}>{t(TRACKING_I18N_KEYS.DESTINATION)}</Text>
      )}

      {permissionStatus === 'denied' && (
        <Text style={styles.permission} testID="enroute-permission-denied">
          {t(TRACKING_I18N_KEYS.PERMISSION_EXPLAINER)}
        </Text>
      )}

      {permissionStatus !== 'granted' && (
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => void requestPermission()}
          testID="enroute-request-permission"
        >
          <Text style={styles.secondaryButtonText}>{t(TRACKING_I18N_KEYS.PERMISSION_DENIED)}</Text>
        </TouchableOpacity>
      )}

      {isMatched && (
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => void startEnRoute(sessionId)}
          testID="enroute-start-heading"
        >
          <Text style={styles.primaryButtonText}>{t(TRACKING_I18N_KEYS.START_HEADING)}</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[styles.primaryButton, !isArrived && styles.disabledButton]}
        disabled={!isArrived}
        onPress={() => void markStarted(sessionId)}
        testID="enroute-start-work"
      >
        <Text style={styles.primaryButtonText}>{t(TRACKING_I18N_KEYS.START_WORK)}</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: TRACKING_COLORS.BACKGROUND, padding: 16 },
  title: { color: TRACKING_COLORS.TEXT, fontSize: 24, fontWeight: '700', marginBottom: 12 },
  stateLabel: { color: TRACKING_COLORS.ACCENT, fontSize: 16, marginBottom: 16 },
  destination: { color: TRACKING_COLORS.TEXT, fontSize: 15, marginBottom: 8 },
  permission: { color: 'rgba(255,255,255,0.7)', fontSize: 14, marginBottom: 12 },
  primaryButton: {
    backgroundColor: TRACKING_COLORS.ACCENT,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  primaryButtonText: { color: TRACKING_COLORS.BACKGROUND, fontSize: 16, fontWeight: '700' },
  disabledButton: { opacity: 0.4 },
  secondaryButton: {
    backgroundColor: TRACKING_COLORS.CARD,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  secondaryButtonText: { color: TRACKING_COLORS.TEXT, fontSize: 15 },
});
