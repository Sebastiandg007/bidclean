/**
 * OfflineBanner — Displays a persistent banner when the device is offline.
 *
 * Shows:
 * - "Offline — data may be outdated" when connectionStatus = 'disconnected'
 * - "Reconnecting..." when connectionStatus = 'reconnecting'
 * - "Live updates paused" when in polling fallback mode
 *
 * Automatically hides when connectionStatus = 'connected'.
 * Uses slide-in/slide-out animation for smooth transitions.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { ConnectionStatus } from '../radar.types';
import { useRadarStore } from '../useRadarStore';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  bannerBg: 'rgba(31, 40, 51, 0.95)',
  bannerBorder: 'rgba(255, 255, 255, 0.1)',
  textWarning: '#FFAD33',
  textReconnecting: '#00F5D4',
  textPaused: 'rgba(255, 255, 255, 0.6)',
} as const;

const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
} as const;

const FONT_SIZE = {
  body: 13,
} as const;

// ─── Constants ───────────────────────────────────────────────────────────────

const BANNER_HEIGHT = 36;
const BORDER_RADIUS = 8;
const ANIMATION_DURATION = 250;
const DOT_SIZE = 6;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OfflineBannerProps {
  /** Whether the system is in polling fallback mode */
  isPollingFallback?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getBannerConfig(
  status: ConnectionStatus,
  isPollingFallback: boolean,
): { text: string; color: string; dotColor: string } | null {
  if (status === 'connected' && !isPollingFallback) {
    return null;
  }

  if (isPollingFallback) {
    return {
      text: 'connectivity.liveUpdatesPaused',
      color: COLORS.textPaused,
      dotColor: COLORS.textPaused,
    };
  }

  if (status === 'reconnecting') {
    return {
      text: 'connectivity.reconnecting',
      color: COLORS.textReconnecting,
      dotColor: COLORS.textReconnecting,
    };
  }

  return {
    text: 'connectivity.offline',
    color: COLORS.textWarning,
    dotColor: COLORS.textWarning,
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function OfflineBanner({ isPollingFallback = false }: OfflineBannerProps): React.JSX.Element | null {
  const { t } = useTranslation('radar');
  const connectionStatus = useRadarStore((state) => state.connectionStatus);

  const config = getBannerConfig(connectionStatus, isPollingFallback);
  const isVisible = config !== null;

  // ─── Animation ───────────────────────────────────────────────────────────

  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-BANNER_HEIGHT)).current;

  useEffect(() => {
    if (isVisible) {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: ANIMATION_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: ANIMATION_DURATION,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: ANIMATION_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: -BANNER_HEIGHT,
          duration: ANIMATION_DURATION,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isVisible, opacity, translateY]);

  if (!config) return null;

  return (
    <Animated.View
      style={[
        styles.banner,
        { opacity, transform: [{ translateY }] },
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID="offline-banner"
    >
      <View style={[styles.dot, { backgroundColor: config.dotColor }]} />
      <Text style={[styles.text, { color: config.color }]}>
        {t(config.text)}
      </Text>
    </Animated.View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: BANNER_HEIGHT,
    backgroundColor: COLORS.bannerBg,
    borderRadius: BORDER_RADIUS,
    borderWidth: 1,
    borderColor: COLORS.bannerBorder,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    marginRight: SPACING.sm,
  },
  text: {
    fontSize: FONT_SIZE.body,
    fontWeight: '500',
  },
});

export default OfflineBanner;
