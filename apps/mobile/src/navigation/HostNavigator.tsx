/**
 * HostNavigator — Custom bottom tab navigation for the Host experience.
 *
 * Provides 4 tabs: Home, Properties, Activity, Profile.
 * Built with React Native primitives and react-native-reanimated for animations.
 *
 * REQ-4: Host mode shows ONLY Host functionality.
 * REQ-5: Profile tab contains the role switch option.
 */

import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import RoleSwitchButton from '../screens/roles/RoleSwitchButton';
import { PropertyListScreen } from '../screens/properties/PropertyListScreen';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  background: '#0B0C10',
  card: '#1F2833',
  accent: '#00F5D4',
  textPrimary: '#FFFFFF',
  textMuted: 'rgba(255, 255, 255, 0.5)',
} as const;

const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

const FONT_SIZE = {
  tabLabel: 11,
  tabIcon: 22,
  screenTitle: 28,
  screenSubtitle: 14,
} as const;

const TAB_BAR_HEIGHT = 64;

const SPRING_CONFIG = {
  damping: 15,
  stiffness: 150,
  mass: 0.5,
} as const;

// ─── Tab Definitions ─────────────────────────────────────────────────────────

interface TabDefinition {
  /** Unique tab identifier */
  key: string;
  /** i18n key for the tab label */
  labelKey: string;
  /** Default label fallback */
  defaultLabel: string;
  /** Unicode icon placeholder (will be replaced by custom icons later) */
  icon: string;
  /** Accessibility label i18n key */
  a11yKey: string;
  /** Default accessibility label */
  a11yDefault: string;
}

const HOST_TABS: TabDefinition[] = [
  {
    key: 'home',
    labelKey: 'navigation.host.tabs.home',
    defaultLabel: 'Home',
    icon: '🏠',
    a11yKey: 'navigation.host.tabs.home.a11y',
    a11yDefault: 'Home tab',
  },
  {
    key: 'properties',
    labelKey: 'navigation.host.tabs.properties',
    defaultLabel: 'Properties',
    icon: '🏢',
    a11yKey: 'navigation.host.tabs.properties.a11y',
    a11yDefault: 'Properties tab',
  },
  {
    key: 'activity',
    labelKey: 'navigation.host.tabs.activity',
    defaultLabel: 'Activity',
    icon: '📋',
    a11yKey: 'navigation.host.tabs.activity.a11y',
    a11yDefault: 'Activity tab',
  },
  {
    key: 'profile',
    labelKey: 'navigation.host.tabs.profile',
    defaultLabel: 'Profile',
    icon: '👤',
    a11yKey: 'navigation.host.tabs.profile.a11y',
    a11yDefault: 'Profile tab',
  },
] as const;

const DEFAULT_TAB_INDEX = 0;

// ─── Tab Screen Placeholders ─────────────────────────────────────────────────

/**
 * Renders the active screen for the current tab.
 * Properties tab uses PropertyListScreen; others show placeholder.
 * Profile tab includes the RoleSwitchButton (REQ-5).
 */
function TabScreen({ tabKey, label }: { tabKey: string; label: string }) {
  const { t } = useTranslation();

  if (tabKey === 'properties') {
    return <PropertyListScreen />;
  }

  return (
    <View style={styles.screenContainer} testID={`host-screen-${tabKey}`}>
      <Text style={styles.screenTitle}>{label}</Text>
      <Text style={styles.screenSubtitle}>
        {t('navigation.host.screen.placeholder', {
          defaultValue: 'Coming soon',
        })}
      </Text>
      {tabKey === 'profile' && <RoleSwitchButton />}
    </View>
  );
}

// ─── Animated Tab Button ─────────────────────────────────────────────────────

interface TabButtonProps {
  tab: TabDefinition;
  isActive: boolean;
  onPress: () => void;
}

/**
 * Individual tab button with animated scale on press and active state styling.
 */
function TabButton({ tab, isActive, onPress }: TabButtonProps) {
  const { t } = useTranslation();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.9, SPRING_CONFIG);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, SPRING_CONFIG);
  }, [scale]);

  const labelColor = isActive ? COLORS.accent : COLORS.textMuted;

  return (
    <Pressable
      style={styles.tabButton}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityRole="tab"
      accessibilityLabel={t(tab.a11yKey, { defaultValue: tab.a11yDefault })}
      accessibilityState={{ selected: isActive }}
      testID={`host-tab-${tab.key}`}
    >
      <Animated.View style={[styles.tabContent, animatedStyle]}>
        <Text style={[styles.tabIcon, { opacity: isActive ? 1 : 0.5 }]}>
          {tab.icon}
        </Text>
        <Text style={[styles.tabLabel, { color: labelColor }]}>
          {t(tab.labelKey, { defaultValue: tab.defaultLabel })}
        </Text>
        {isActive && <View style={styles.activeIndicator} />}
      </Animated.View>
    </Pressable>
  );
}

// ─── Tab Bar ─────────────────────────────────────────────────────────────────

interface TabBarProps {
  activeIndex: number;
  onTabPress: (index: number) => void;
}

/**
 * Custom bottom tab bar rendering all Host tabs.
 */
function HostTabBar({ activeIndex, onTabPress }: TabBarProps) {
  return (
    <View
      style={styles.tabBar}
      accessibilityRole="tablist"
      testID="host-tab-bar"
    >
      {HOST_TABS.map((tab, index) => (
        <TabButton
          key={tab.key}
          tab={tab}
          isActive={index === activeIndex}
          onPress={() => onTabPress(index)}
        />
      ))}
    </View>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

/**
 * Host tab navigator with 4 tabs: Home, Properties, Activity, Profile.
 *
 * Uses a custom bottom tab bar built with React Native primitives.
 * Tab switching is animated with react-native-reanimated spring physics.
 */
export default function HostNavigator() {
  const [activeIndex, setActiveIndex] = useState(DEFAULT_TAB_INDEX);
  const { t } = useTranslation();

  const handleTabPress = useCallback((index: number) => {
    setActiveIndex(index);
  }, []);

  const activeTab = HOST_TABS[activeIndex] as TabDefinition;
  const activeLabel = t(activeTab.labelKey, {
    defaultValue: activeTab.defaultLabel,
  });

  return (
    <View style={styles.container} testID="host-navigator">
      <View style={styles.screenArea}>
        <TabScreen tabKey={activeTab.key} label={activeLabel} />
      </View>
      <HostTabBar activeIndex={activeIndex} onTabPress={handleTabPress} />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  screenArea: {
    flex: 1,
  },
  screenContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  screenTitle: {
    fontSize: FONT_SIZE.screenTitle,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  screenSubtitle: {
    fontSize: FONT_SIZE.screenSubtitle,
    color: COLORS.textMuted,
  },
  tabBar: {
    flexDirection: 'row',
    height: TAB_BAR_HEIGHT,
    backgroundColor: COLORS.card,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    paddingBottom: SPACING.xs,
  },
  tabButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabContent: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.sm,
  },
  tabIcon: {
    fontSize: FONT_SIZE.tabIcon,
    marginBottom: SPACING.xs,
  },
  tabLabel: {
    fontSize: FONT_SIZE.tabLabel,
    fontWeight: '600',
  },
  activeIndicator: {
    position: 'absolute',
    top: -SPACING.sm,
    width: SPACING.xl,
    height: 3,
    borderRadius: 2,
    backgroundColor: COLORS.accent,
  },
});
