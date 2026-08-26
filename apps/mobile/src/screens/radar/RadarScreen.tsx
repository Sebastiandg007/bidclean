/**
 * RadarScreen — Main container for the Cleaner's Offer Radar.
 *
 * Assembles all radar sub-components and manages the mount/unmount lifecycle:
 * - Location permission request → initial data fetch → WebSocket subscription
 * - Urgency timer (60s recalculation)
 * - View mode toggle (map vs. list)
 * - Filter panel (bottom sheet)
 * - Offer preview sheet (on pin/card tap)
 * - Offline banner and connectivity indicator
 * - Empty states (no offers / all filtered out)
 * - Skeleton loaders during initial data fetch
 *
 * @requirements 1.2, 3.1, 12.5, 12.6
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../../stores/auth.store';
import { useProfileStore } from '../profile/useProfile';
import { useRadarStore } from './useRadarStore';
import { useLocationPermission } from './useLocationPermission';
import { useRadarReconciliation } from './hooks/useRadarReconciliation';
import { useUrgencyTimer } from './hooks/useUrgencyTimer';
import type { GeoPoint } from './radar.types';

import { RadarMapView } from './components/map/RadarMapView';
import { OfferListView } from './components/list/OfferListView';
import { FilterPanel } from './components/filters/FilterPanel';
import { OfferPreviewSheet } from './components/OfferPreviewSheet';
import { EmptyState } from './components/EmptyState';
import { OfflineBanner } from './components/OfflineBanner';
import { ConnectivityIndicator } from './components/ConnectivityIndicator';
import { ViewToggle } from './components/ViewToggle';
import { RadarHeader } from './components/RadarHeader';
import { RadarSkeleton } from './components/RadarSkeleton';
import { LocationDeniedFallback } from './components/LocationDeniedFallback';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  background: '#0B0C10',
} as const;

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default work zone radius when profile data is unavailable (meters) */
const DEFAULT_WORK_ZONE_RADIUS_METERS = 10_000;

/** Conversion factor from km to meters */
const KM_TO_METERS = 1_000;

// ─── Component ───────────────────────────────────────────────────────────────

export function RadarScreen(): React.JSX.Element {
  const { t } = useTranslation('radar');

  // ─── Auth (Cleaner ID) ─────────────────────────────────────────────────

  const cleanerId = useAuthStore((state) => state.user?.id ?? '');

  // ─── Profile (Work Zone) ───────────────────────────────────────────────

  const profile = useProfileStore((state) => state.profile);
  const fetchProfile = useProfileStore((state) => state.fetchProfile);

  const workZoneCenter: GeoPoint = useMemo(() => {
    const center = profile?.cleaner?.workZoneCenter;
    if (center) {
      return { lat: center.lat, lng: center.lng };
    }
    return { lat: 0, lng: 0 };
  }, [profile?.cleaner?.workZoneCenter]);

  const workZoneRadiusMeters: number = useMemo(() => {
    const radiusKm = profile?.cleaner?.workZoneRadiusKm;
    if (radiusKm !== null && radiusKm !== undefined) {
      return radiusKm * KM_TO_METERS;
    }
    return DEFAULT_WORK_ZONE_RADIUS_METERS;
  }, [profile?.cleaner?.workZoneRadiusKm]);

  // ─── Location Permission ───────────────────────────────────────────────

  const {
    status: locationStatus,
    location: cleanerLocation,
    isLoading: isLocationLoading,
    requestPermission,
    openSettings,
  } = useLocationPermission();

  // ─── Radar Store ───────────────────────────────────────────────────────

  const offers = useRadarStore((state) => state.offers);
  const viewMode = useRadarStore((state) => state.viewMode);
  const connectionStatus = useRadarStore((state) => state.connectionStatus);
  const isLoading = useRadarStore((state) => state.isLoading);
  const selectedOfferId = useRadarStore((state) => state.selectedOfferId);
  const getActiveFilterCount = useRadarStore((state) => state.getActiveFilterCount);
  const fetchAvailableOffers = useRadarStore((state) => state.fetchAvailableOffers);

  // ─── WebSocket & Reconciliation ────────────────────────────────────────

  const { isPolling } = useRadarReconciliation(cleanerId);

  // ─── Urgency Timer ─────────────────────────────────────────────────────

  useUrgencyTimer({ enabled: locationStatus === 'granted' && offers.size > 0 });

  // ─── Filter Panel State ────────────────────────────────────────────────

  const [isFilterPanelVisible, setIsFilterPanelVisible] = useState(false);

  const handleFilterOpen = useCallback((): void => {
    setIsFilterPanelVisible(true);
  }, []);

  const handleFilterClose = useCallback((): void => {
    setIsFilterPanelVisible(false);
  }, []);

  // ─── Empty State Actions ───────────────────────────────────────────────

  const handleExpandWorkZone = useCallback((): void => {
    // Navigate to settings/profile to adjust work zone
    // Placeholder: navigation integration depends on the navigation stack
  }, []);

  // ─── Initial Data Load ─────────────────────────────────────────────────

  useEffect(() => {
    if (locationStatus === 'granted') {
      fetchAvailableOffers();
    }
  }, [locationStatus, fetchAvailableOffers]);

  // Ensure profile data is loaded for work zone display
  useEffect(() => {
    if (!profile && cleanerId) {
      fetchProfile();
    }
  }, [profile, cleanerId, fetchProfile]);

  // ─── Derived State ─────────────────────────────────────────────────────

  const hasOffers = offers.size > 0;
  const isInitialLoad = isLoading && !hasOffers;
  const activeFilterCount = getActiveFilterCount();
  const hasActiveFilters = activeFilterCount > 0;

  const emptyStateVariant = hasActiveFilters ? 'no-matching-filters' : 'no-offers';

  const mapCenter: GeoPoint = useMemo(() => {
    // Prefer Cleaner GPS for map centering; fall back to work zone center
    if (cleanerLocation) {
      return cleanerLocation;
    }
    return workZoneCenter;
  }, [cleanerLocation, workZoneCenter]);

  // ─── Location Permission Denied ────────────────────────────────────────

  if (locationStatus === 'denied') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <LocationDeniedFallback
          onRequestPermission={requestPermission}
          onOpenSettings={openSettings}
        />
      </SafeAreaView>
    );
  }

  // ─── Loading (permission check in progress) ────────────────────────────

  if (isLocationLoading || locationStatus === 'undetermined') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <RadarSkeleton />
      </SafeAreaView>
    );
  }

  // ─── Main Render ───────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header: connectivity indicator + filter button + badge */}
      <RadarHeader
        activeFilterCount={activeFilterCount}
        onFilterPress={handleFilterOpen}
      />

      {/* Offline / Reconnecting Banner */}
      <OfflineBanner isPollingFallback={isPolling} />

      {/* View Toggle (map ↔ list) */}
      <View style={styles.toggleContainer}>
        <ViewToggle />
        <ConnectivityIndicator />
      </View>

      {/* Main Content Area */}
      <View style={styles.content}>
        {isInitialLoad ? (
          <RadarSkeleton />
        ) : !hasOffers ? (
          <EmptyState
            variant={emptyStateVariant}
            onAction={hasActiveFilters ? undefined : handleExpandWorkZone}
          />
        ) : viewMode === 'map' ? (
          <RadarMapView
            cleanerLocation={mapCenter}
            workZoneCenter={workZoneCenter}
            workZoneRadiusMeters={workZoneRadiusMeters}
            isDarkMode
          />
        ) : (
          <OfferListView />
        )}
      </View>

      {/* Filter Panel (bottom sheet) */}
      <FilterPanel
        visible={isFilterPanelVisible}
        onClose={handleFilterClose}
      />

      {/* Offer Preview Sheet (opens on pin/card tap) */}
      {selectedOfferId !== null && <OfferPreviewSheet />}
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  toggleContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 12,
  },
  content: {
    flex: 1,
  },
});

export default RadarScreen;
