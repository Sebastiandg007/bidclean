/**
 * CleanerNavigator — Custom bottom tab navigation for the Cleaner experience.
 *
 * Provides 3 tabs: Radar, Active, Profile.
 * Built with React Native primitives and react-native-reanimated for animations.
 *
 * REQ-4: Cleaner mode shows ONLY Cleaner functionality.
 * REQ-5: Profile tab contains the role switch option.
 */

import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import RoleSwitchButton from '../screens/roles/RoleSwitchButton';
import { ChatEntryScreen } from '../screens/chat/ChatEntryScreen';
import { CHAT_ROUTE } from '../screens/chat/chat.constants';

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

const CLEANER_TABS: TabDefinition[] = [
  {
    key: 'radar',
    labelKey: 'navigation.cleaner.tabs.radar',
    defaultLabel: 'Radar',
    icon: '📡',
    a11yKey: 'navigation.cleaner.tabs.radar.a11y',
    a11yDefault: 'Radar tab',
  },
  {
    key: 'active',
    labelKey: 'navigation.cleaner.tabs.active',
    defaultLabel: 'Active',
    icon: '⚡',
    a11yKey: 'navigation.cleaner.tabs.active.a11y',
    a11yDefault: 'Active tab',
  },
  {
    key: 'profile',
    labelKey: 'navigation.cleaner.tabs.profile',
    defaultLabel: 'Profile',
    icon: '👤',
    a11yKey: 'navigation.cleaner.tabs.profile.a11y',
    a11yDefault: 'Profile tab',
  },
] as const;

const DEFAULT_TAB_INDEX = 0;

// ─── Active Stack Navigator ──────────────────────────────────────────────────

const ACTIVE_ROUTES = { ActiveList: 'ActiveList' } as const;

interface StackEntry {
  screen: string;
  params?: Record<string, unknown>;
}

interface StackNavigation {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
}

/**
 * Lightweight local stack for the Active tab. Starts on the active-jobs list placeholder and can
 * push the chat entry screen for a matched thread (mirrors the Host Offers stack pattern).
 */
function ActiveStackNavigator() {
  const { t } = useTranslation();
  const [stack, setStack] = useState<StackEntry[]>([{ screen: ACTIVE_ROUTES.ActiveList }]);

  const navigation: StackNavigation = useMemo(
    () => ({
      navigate: (screen: string, params?: Record<string, unknown>) =>
        setStack((prev) => [...prev, { screen, params }]),
      goBack: () => setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev)),
    }),
    [],
  );

  const currentEntry = stack[stack.length - 1] as StackEntry;

  if (currentEntry.screen === CHAT_ROUTE) {
    return (
      <ChatEntryScreen
        navigation={navigation}
        route={{ params: currentEntry.params as { threadId: string } }}
      />
    );
  }

  return (
    <View style={styles.screenContainer} testID="cleaner-screen-active">
      <Text style={styles.screenTitle}>
        {t('navigation.cleaner.tabs.active', { defaultValue: 'Active' })}
      </Text>
      <Text style={styles.screenSubtitle}>
        {t('navigation.cleaner.screen.placeholder', { defaultValue: 'Coming soon' })}
      </Text>
    </View>
  );
}

// ─── Tab Screen Placeholders ─────────────────────────────────────────────────

/**
 * Renders the active screen for each Cleaner tab.
 * Active tab uses the local stack navigator (list → chat).
 * Profile tab includes the RoleSwitchButton (REQ-5).
 */
function TabScreen({ tabKey, label }: { tabKey: string; label: string }) {
  const { t } = useTranslation();

  if (tabKey === 'active') {
    return <ActiveStackNavigator />;
  }

  return (
    <View style={styles.screenContainer} testID={`cleaner-screen-${tabKey}`}>
      <Text style={styles.screenTitle}>{label}</Text>
      <Text style={styles.screenSubtitle}>
        {t('navigation.cleaner.screen.placeholder', {
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
      testID={`cleaner-tab-${tab.key}`}
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
 * Custom bottom tab bar rendering all Cleaner tabs.
 */
function CleanerTabBar({ activeIndex, onTabPress }: TabBarProps) {
  return (
    <View
      style={styles.tabBar}
      accessibilityRole="tablist"
      testID="cleaner-tab-bar"
    >
      {CLEANER_TABS.map((tab, index) => (
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
 * Cleaner tab navigator with 3 tabs: Radar, Active, Profile.
 *
 * Uses a custom bottom tab bar built with React Native primitives.
 * Tab switching is animated with react-native-reanimated spring physics.
 */
export default function CleanerNavigator() {
  const [activeIndex, setActiveIndex] = useState(DEFAULT_TAB_INDEX);
  const { t } = useTranslation();

  const handleTabPress = useCallback((index: number) => {
    setActiveIndex(index);
  }, []);

  const activeTab = CLEANER_TABS[activeIndex] as TabDefinition;
  const activeLabel = t(activeTab.labelKey, {
    defaultValue: activeTab.defaultLabel,
  });

  return (
    <View style={styles.container} testID="cleaner-navigator">
      <View style={styles.screenArea}>
        <TabScreen tabKey={activeTab.key} label={activeLabel} />
      </View>
      <CleanerTabBar activeIndex={activeIndex} onTabPress={handleTabPress} />
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
