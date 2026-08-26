/**
 * ConnectivityIndicator — Subtle status dot showing WebSocket connection state.
 *
 * Displays a small colored dot indicating:
 * - Green (#00F5D4): connected (WebSocket live)
 * - Yellow (#FFAD33): reconnecting (attempting to restore)
 * - Red (#FF4D4D): disconnected
 *
 * Positioned inline (typically in a header/toolbar area).
 * Minimal footprint — communicates status without being distracting.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import type { ConnectionStatus } from '../radar.types';
import { useRadarStore } from '../useRadarStore';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const DOT_COLORS: Record<ConnectionStatus, string> = {
  connected: '#00F5D4',
  reconnecting: '#FFAD33',
  disconnected: '#FF4D4D',
} as const;

// ─── Constants ───────────────────────────────────────────────────────────────

const DOT_SIZE = 8;
const PULSE_DURATION = 1200;
const PULSE_MIN_OPACITY = 0.4;
const PULSE_MAX_OPACITY = 1.0;

// ─── Component ───────────────────────────────────────────────────────────────

export function ConnectivityIndicator(): React.JSX.Element {
  const connectionStatus = useRadarStore((state) => state.connectionStatus);
  const dotColor = DOT_COLORS[connectionStatus];

  // Pulse animation when reconnecting
  const pulseAnim = useRef(new Animated.Value(PULSE_MAX_OPACITY)).current;
  const pulseRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (connectionStatus === 'reconnecting') {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: PULSE_MIN_OPACITY,
            duration: PULSE_DURATION / 2,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: PULSE_MAX_OPACITY,
            duration: PULSE_DURATION / 2,
            useNativeDriver: true,
          }),
        ]),
      );
      pulseRef.current = animation;
      animation.start();
    } else {
      pulseRef.current?.stop();
      pulseAnim.setValue(PULSE_MAX_OPACITY);
    }

    return () => {
      pulseRef.current?.stop();
    };
  }, [connectionStatus, pulseAnim]);

  const accessibilityLabel =
    connectionStatus === 'connected'
      ? 'Connected'
      : connectionStatus === 'reconnecting'
        ? 'Reconnecting'
        : 'Disconnected';

  return (
    <View
      style={styles.container}
      accessibilityRole="none"
      accessibilityLabel={accessibilityLabel}
      testID="connectivity-indicator"
    >
      <Animated.View
        style={[
          styles.dot,
          { backgroundColor: dotColor, opacity: pulseAnim },
        ]}
        testID={`connectivity-dot-${connectionStatus}`}
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 4,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
});

export default ConnectivityIndicator;
