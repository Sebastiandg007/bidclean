/**
 * ViewToggle — Segmented control for switching between Map and List views.
 *
 * Toggles `viewMode` in the Zustand store ('map' | 'list').
 * Renders a pill-shaped segmented control with animated selection indicator.
 * Uses i18n keys for labels.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { Animated, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { makeStyles } from '../../../theme';
import type { ViewMode } from '../radar.types';
import { useRadarStore } from '../useRadarStore';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const FONT_SIZE = {
  button: 13,
} as const;

// ─── Constants ───────────────────────────────────────────────────────────────

const CONTAINER_HEIGHT = 36;
const CONTAINER_BORDER_RADIUS = 18;
const CONTAINER_PADDING = 3;
const SEGMENT_BORDER_RADIUS = 15;
const ANIMATION_DURATION = 200;

// ─── Types ───────────────────────────────────────────────────────────────────

interface SegmentConfig {
  key: ViewMode;
  labelKey: string;
}

const SEGMENTS: SegmentConfig[] = [
  { key: 'map', labelKey: 'viewToggle.map' },
  { key: 'list', labelKey: 'viewToggle.list' },
];

// ─── Component ───────────────────────────────────────────────────────────────

export function ViewToggle(): React.JSX.Element {
  const { t } = useTranslation('radar');
  const styles = useStyles();
  const viewMode = useRadarStore((state) => state.viewMode);
  const setViewMode = useRadarStore((state) => state.setViewMode);

  // Animated position for the selection pill (0 = left, 1 = right)
  const slideAnim = useRef(new Animated.Value(viewMode === 'map' ? 0 : 1)).current;

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: viewMode === 'map' ? 0 : 1,
      duration: ANIMATION_DURATION,
      useNativeDriver: false,
    }).start();
  }, [viewMode, slideAnim]);

  const handlePress = useCallback(
    (mode: ViewMode): void => {
      if (mode !== viewMode) {
        setViewMode(mode);
      }
    },
    [viewMode, setViewMode],
  );

  // Interpolate the selection indicator position
  const segmentWidth = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '50%'],
  });

  return (
    <View style={styles.container} testID="view-toggle">
      {/* Animated selection indicator */}
      <Animated.View
        style={[
          styles.indicator,
          { left: segmentWidth },
        ]}
      />

      {/* Segments */}
      {SEGMENTS.map((segment) => {
        const isActive = viewMode === segment.key;
        return (
          <TouchableOpacity
            key={segment.key}
            style={styles.segment}
            onPress={() => handlePress(segment.key)}
            activeOpacity={0.7}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            testID={`view-toggle-${segment.key}`}
          >
            <Text
              style={[
                styles.label,
                isActive ? styles.labelActive : styles.labelInactive,
              ]}
            >
              {t(segment.labelKey)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles((theme) => ({
  container: {
    flexDirection: 'row',
    height: CONTAINER_HEIGHT,
    backgroundColor: theme.surface,
    borderRadius: CONTAINER_BORDER_RADIUS,
    padding: CONTAINER_PADDING,
    position: 'relative',
  },
  indicator: {
    position: 'absolute',
    top: CONTAINER_PADDING,
    bottom: CONTAINER_PADDING,
    width: '50%',
    backgroundColor: theme.accent,
    borderRadius: SEGMENT_BORDER_RADIUS,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  label: {
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
  },
  labelActive: {
    color: theme.onAccent,
  },
  labelInactive: {
    color: theme.textSecondary,
  },
}));

export default ViewToggle;
