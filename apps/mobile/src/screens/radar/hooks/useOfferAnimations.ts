/**
 * useOfferAnimations — Reanimated 3 spring configurations for radar pin animations.
 *
 * Provides:
 * - Pin entrance animation (drop + bounce, 300ms)
 * - Pin exit animation (fade + scale down, 250ms)
 * - Urgency pulse animation (pulsing ring for urgent offers)
 * - Optional haptic feedback on new pin appearance
 *
 * Uses spring constants from radar.constants.ts for consistency.
 * All animations leverage Reanimated 3's spring physics API.
 */

import { useCallback, useRef } from 'react';
import {
  useSharedValue,
  withSpring,
  withTiming,
  withSequence,
  withRepeat,
  runOnJS,
  type SharedValue,
  type WithSpringConfig,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import {
  PIN_ENTRANCE_SPRING,
  PIN_EXIT_SPRING,
  URGENCY_PULSE_SPRING,
  PIN_ENTRANCE_DURATION_MS,
  PIN_EXIT_DURATION_MS,
} from '../radar.constants';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PinAnimationValues {
  /** Scale value for entrance/exit (0 → 1 entrance, 1 → 0 exit) */
  scale: SharedValue<number>;
  /** Opacity value (0 → 1 entrance, 1 → 0 exit) */
  opacity: SharedValue<number>;
  /** Vertical translation for drop effect (negative → 0) */
  translateY: SharedValue<number>;
}

export interface UrgencyPulseValues {
  /** Scale of the urgency pulse ring (1.0 → 1.8 → 1.0) */
  pulseScale: SharedValue<number>;
  /** Opacity of the urgency pulse ring (0.4 → 0.0 → 0.4) */
  pulseOpacity: SharedValue<number>;
}

export interface UseOfferAnimationsReturn {
  /** Spring config for pin entrance (drop + bounce) */
  entranceSpringConfig: WithSpringConfig;
  /** Spring config for pin exit (fade + scale) */
  exitSpringConfig: WithSpringConfig;
  /** Spring config for urgency pulse loop */
  urgencyPulseSpringConfig: WithSpringConfig;
  /** Triggers pin entrance animation on shared values */
  animateEntrance: (values: PinAnimationValues) => void;
  /** Triggers pin exit animation on shared values */
  animateExit: (values: PinAnimationValues) => void;
  /** Starts the urgency pulse loop */
  startUrgencyPulse: (values: UrgencyPulseValues) => void;
  /** Stops the urgency pulse loop */
  stopUrgencyPulse: (values: UrgencyPulseValues) => void;
  /** Creates a new set of pin animation shared values */
  createPinAnimationValues: () => PinAnimationValues;
  /** Creates urgency pulse shared values */
  createUrgencyPulseValues: () => UrgencyPulseValues;
  /** Triggers haptic feedback for new pin appearance */
  triggerHapticFeedback: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Vertical drop distance for entrance animation (pixels) */
const ENTRANCE_DROP_DISTANCE = -30;

/** Scale target for fully visible pin */
const SCALE_VISIBLE = 1;

/** Scale target for hidden pin */
const SCALE_HIDDEN = 0;

/** Opacity target for fully visible */
const OPACITY_VISIBLE = 1;

/** Opacity target for hidden */
const OPACITY_HIDDEN = 0;

/** Urgency pulse min scale */
const PULSE_MIN_SCALE = 1.0;

/** Urgency pulse max scale */
const PULSE_MAX_SCALE = 1.8;

/** Urgency pulse min opacity (at max scale) */
const PULSE_MIN_OPACITY = 0.0;

/** Urgency pulse max opacity (at min scale) */
const PULSE_MAX_OPACITY = 0.4;

/** Number of times urgency pulse repeats (-1 = infinite) */
const PULSE_REPEAT_COUNT = -1;

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Provides Reanimated 3 animation utilities for radar pin lifecycle.
 *
 * @param enableHaptics - Whether to trigger haptic feedback on new pins (default: true)
 */
export function useOfferAnimations(enableHaptics = true): UseOfferAnimationsReturn {
  const hapticsEnabled = useRef(enableHaptics);
  hapticsEnabled.current = enableHaptics;

  // ─── Spring Configs ──────────────────────────────────────────────────────

  const entranceSpringConfig: WithSpringConfig = {
    damping: PIN_ENTRANCE_SPRING.damping,
    stiffness: PIN_ENTRANCE_SPRING.stiffness,
    mass: PIN_ENTRANCE_SPRING.mass,
  };

  const exitSpringConfig: WithSpringConfig = {
    damping: PIN_EXIT_SPRING.damping,
    stiffness: PIN_EXIT_SPRING.stiffness,
    mass: PIN_EXIT_SPRING.mass,
  };

  const urgencyPulseSpringConfig: WithSpringConfig = {
    damping: URGENCY_PULSE_SPRING.damping,
    stiffness: URGENCY_PULSE_SPRING.stiffness,
    mass: URGENCY_PULSE_SPRING.mass,
  };

  // ─── Animation Triggers ──────────────────────────────────────────────────

  const triggerHapticFeedback = useCallback((): void => {
    if (hapticsEnabled.current) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
        // Silently fail — haptics not critical
      });
    }
  }, []);

  const animateEntrance = useCallback(
    (values: PinAnimationValues): void => {
      // Start from hidden state
      values.scale.value = SCALE_HIDDEN;
      values.opacity.value = OPACITY_HIDDEN;
      values.translateY.value = ENTRANCE_DROP_DISTANCE;

      // Animate to visible with spring physics (drop + bounce)
      values.scale.value = withSpring(SCALE_VISIBLE, entranceSpringConfig);
      values.opacity.value = withTiming(OPACITY_VISIBLE, {
        duration: PIN_ENTRANCE_DURATION_MS,
      });
      values.translateY.value = withSpring(0, entranceSpringConfig);

      // Haptic on entrance
      runOnJS(triggerHapticFeedback)();
    },
    [entranceSpringConfig, triggerHapticFeedback],
  );

  const animateExit = useCallback(
    (values: PinAnimationValues): void => {
      // Animate to hidden with spring physics (fade + scale down)
      values.scale.value = withSpring(SCALE_HIDDEN, exitSpringConfig);
      values.opacity.value = withTiming(OPACITY_HIDDEN, {
        duration: PIN_EXIT_DURATION_MS,
      });
    },
    [exitSpringConfig],
  );

  const startUrgencyPulse = useCallback(
    (values: UrgencyPulseValues): void => {
      // Infinite pulsing scale animation
      values.pulseScale.value = withRepeat(
        withSequence(
          withSpring(PULSE_MAX_SCALE, urgencyPulseSpringConfig),
          withSpring(PULSE_MIN_SCALE, urgencyPulseSpringConfig),
        ),
        PULSE_REPEAT_COUNT,
        false,
      );

      // Inverse opacity: fades out as scale grows
      values.pulseOpacity.value = withRepeat(
        withSequence(
          withSpring(PULSE_MIN_OPACITY, urgencyPulseSpringConfig),
          withSpring(PULSE_MAX_OPACITY, urgencyPulseSpringConfig),
        ),
        PULSE_REPEAT_COUNT,
        false,
      );
    },
    [urgencyPulseSpringConfig],
  );

  const stopUrgencyPulse = useCallback((values: UrgencyPulseValues): void => {
    values.pulseScale.value = PULSE_MIN_SCALE;
    values.pulseOpacity.value = PULSE_MAX_OPACITY;
  }, []);

  // ─── Factories ───────────────────────────────────────────────────────────

  const createPinAnimationValues = useCallback((): PinAnimationValues => {
    return {
      scale: useSharedValue(SCALE_HIDDEN),
      opacity: useSharedValue(OPACITY_HIDDEN),
      translateY: useSharedValue(ENTRANCE_DROP_DISTANCE),
    };
  }, []);

  const createUrgencyPulseValues = useCallback((): UrgencyPulseValues => {
    return {
      pulseScale: useSharedValue(PULSE_MIN_SCALE),
      pulseOpacity: useSharedValue(PULSE_MAX_OPACITY),
    };
  }, []);

  return {
    entranceSpringConfig,
    exitSpringConfig,
    urgencyPulseSpringConfig,
    animateEntrance,
    animateExit,
    startUrgencyPulse,
    stopUrgencyPulse,
    createPinAnimationValues,
    createUrgencyPulseValues,
    triggerHapticFeedback,
  };
}

export default useOfferAnimations;
