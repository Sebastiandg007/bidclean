/**
 * RoleSelectionScreen — Allows users to choose their role(s) in BidClean.
 *
 * Shown after email verification. Users select Host ("I need cleaning"),
 * Cleaner ("I want to work"), or both. At least one role must be selected
 * before proceeding to the corresponding onboarding flow.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
  interpolateColor,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';

import type { RoleSelectionScreenProps, UserRole } from './roles.types';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  background: '#0B0C10',
  card: '#1F2833',
  accent: '#00F5D4',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.6)',
  border: 'rgba(255, 255, 255, 0.2)',
} as const;

const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

const FONT_SIZE = {
  title: 28,
  subtitle: 14,
  cardTitle: 18,
  cardDescription: 14,
  button: 17,
} as const;

// ─── Animation Config ────────────────────────────────────────────────────────

const SPRING_CONFIG = {
  damping: 12,
  stiffness: 90,
  mass: 1,
} as const;

const CARD_SPRING_CONFIG = {
  damping: 14,
  stiffness: 120,
  mass: 0.8,
} as const;

const ENTRANCE_DELAY_MS = 150;
const CARD_STAGGER_MS = 100;

// ─── Role Card Data ──────────────────────────────────────────────────────────

interface RoleCardData {
  role: UserRole;
  emoji: string;
  title: string;
  description: string;
}

const ROLE_CARDS: RoleCardData[] = [
  {
    role: 'host',
    emoji: '🏠',
    title: 'I need cleaning',
    description: 'Find verified professionals for your property',
  },
  {
    role: 'cleaner',
    emoji: '✨',
    title: 'I want to work',
    description: 'Get jobs near you and earn on your schedule',
  },
];

// ─── Animated Role Card Component ────────────────────────────────────────────

interface AnimatedRoleCardProps {
  data: RoleCardData;
  isSelected: boolean;
  onToggle: () => void;
  entranceDelay: number;
}

function AnimatedRoleCard({
  data,
  isSelected,
  onToggle,
  entranceDelay,
}: AnimatedRoleCardProps) {
  const cardScale = useSharedValue(0.8);
  const cardOpacity = useSharedValue(0);
  const selectedProgress = useSharedValue(0);

  useEffect(() => {
    cardScale.value = withDelay(
      entranceDelay,
      withSpring(1, SPRING_CONFIG),
    );
    cardOpacity.value = withDelay(
      entranceDelay,
      withSpring(1, SPRING_CONFIG),
    );
  }, [cardScale, cardOpacity, entranceDelay]);

  useEffect(() => {
    selectedProgress.value = withSpring(
      isSelected ? 1 : 0,
      CARD_SPRING_CONFIG,
    );
  }, [isSelected, selectedProgress]);

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }],
    opacity: cardOpacity.value,
    borderColor: interpolateColor(
      selectedProgress.value,
      [0, 1],
      [COLORS.border, COLORS.accent],
    ),
  }));

  const scaleAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: 1 + selectedProgress.value * 0.02 },
    ],
  }));

  return (
    <Animated.View style={[styles.roleCard, cardAnimatedStyle]}>
      <Pressable
        style={styles.roleCardPressable}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={`${data.title} — ${data.description}`}
        accessibilityState={{ selected: isSelected }}
      >
        <Animated.View style={[styles.roleCardContent, scaleAnimatedStyle]}>
          <Text style={styles.roleEmoji}>{data.emoji}</Text>
          <View style={styles.roleTextContainer}>
            <Text style={styles.roleTitle}>{data.title}</Text>
            <Text style={styles.roleDescription}>{data.description}</Text>
          </View>
          <View
            style={[
              styles.checkIndicator,
              isSelected && styles.checkIndicatorSelected,
            ]}
          >
            <Text style={styles.checkText}>{isSelected ? '✓' : ''}</Text>
          </View>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function RoleSelectionScreen({
  onSubmit,
  onRoleToggled,
}: RoleSelectionScreenProps) {
  const router = useRouter();
  const [selectedRoles, setSelectedRoles] = useState<Set<UserRole>>(new Set());

  const headerOpacity = useSharedValue(0);
  const headerTranslateY = useSharedValue(20);

  useEffect(() => {
    headerOpacity.value = withDelay(
      ENTRANCE_DELAY_MS,
      withSpring(1, SPRING_CONFIG),
    );
    headerTranslateY.value = withDelay(
      ENTRANCE_DELAY_MS,
      withSpring(0, SPRING_CONFIG),
    );
  }, [headerOpacity, headerTranslateY]);

  const headerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [{ translateY: headerTranslateY.value }],
  }));

  const handleToggleRole = useCallback(
    (role: UserRole) => {
      setSelectedRoles((prev) => {
        const next = new Set(prev);
        const willBeSelected = !next.has(role);

        if (willBeSelected) {
          next.add(role);
        } else {
          next.delete(role);
        }

        onRoleToggled?.(role, willBeSelected);
        return next;
      });
    },
    [onRoleToggled],
  );

  const handleContinue = useCallback(() => {
    const roles = Array.from(selectedRoles) as UserRole[];

    if (roles.length === 0) return;

    if (onSubmit) {
      onSubmit(roles);
      return;
    }

    // Default navigation: go to onboarding for the first selected role
    router.push('/onboarding' as never);
  }, [selectedRoles, onSubmit, router]);

  const isSubmitEnabled = selectedRoles.size > 0;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <Animated.View style={[styles.headerSection, headerAnimatedStyle]}>
        <Text style={styles.title}>Choose your role</Text>
        <Text style={styles.subtitle}>
          Select how you want to use BidClean. You can always add another role later.
        </Text>
      </Animated.View>

      {/* Role Cards */}
      <View style={styles.cardsSection}>
        {ROLE_CARDS.map((card, index) => (
          <AnimatedRoleCard
            key={card.role}
            data={card}
            isSelected={selectedRoles.has(card.role)}
            onToggle={() => handleToggleRole(card.role)}
            entranceDelay={ENTRANCE_DELAY_MS + CARD_STAGGER_MS * (index + 1)}
          />
        ))}
      </View>

      {/* Continue Button */}
      <View style={styles.ctaSection}>
        <Pressable
          style={[
            styles.continueButton,
            !isSubmitEnabled && styles.continueButtonDisabled,
          ]}
          onPress={handleContinue}
          disabled={!isSubmitEnabled}
          accessibilityRole="button"
          accessibilityLabel="Continue with selected role"
          accessibilityState={{ disabled: !isSubmitEnabled }}
        >
          <Text
            style={[
              styles.continueButtonText,
              !isSubmitEnabled && styles.continueButtonTextDisabled,
            ]}
          >
            Continue
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingHorizontal: SPACING.lg,
  },
  headerSection: {
    marginTop: SPACING.xxl,
    marginBottom: SPACING.xl,
  },
  title: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: COLORS.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: FONT_SIZE.subtitle,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
    lineHeight: 20,
  },
  cardsSection: {
    flex: 1,
    justifyContent: 'center',
    gap: SPACING.md,
  },
  roleCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  roleCardPressable: {
    padding: SPACING.lg,
  },
  roleCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  roleEmoji: {
    fontSize: 36,
    marginRight: SPACING.md,
  },
  roleTextContainer: {
    flex: 1,
  },
  roleTitle: {
    fontSize: FONT_SIZE.cardTitle,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  roleDescription: {
    fontSize: FONT_SIZE.cardDescription,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
    lineHeight: 20,
  },
  checkIndicator: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: SPACING.sm,
  },
  checkIndicatorSelected: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  checkText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.background,
  },
  ctaSection: {
    paddingBottom: SPACING.xxl,
    paddingTop: SPACING.lg,
  },
  continueButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 12,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  continueButtonDisabled: {
    opacity: 0.4,
  },
  continueButtonText: {
    fontSize: FONT_SIZE.button,
    fontWeight: '600',
    color: COLORS.background,
  },
  continueButtonTextDisabled: {
    color: COLORS.background,
  },
});
