/**
 * ThemeModeSelector — a segmented control for choosing Dark / Light / System.
 *
 * Three options bound to `ThemeMode`, reflecting the current `mode` from `useTheme()`. The active
 * option uses the `accent` token for active-state emphasis (never a surface). Labels come from the
 * `appearance` i18n namespace (`appearance.mode.dark|light|system`) with en/es parity. Tapping an
 * option calls `setMode`, which updates the whole app + native chrome immediately.
 */

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { makeStyles, useTheme, ThemeMode } from '../../../theme';

interface ModeOption {
  mode: ThemeMode;
  labelKey: string;
  testID: string;
}

const MODE_OPTIONS: ModeOption[] = [
  { mode: ThemeMode.DARK, labelKey: 'appearance.mode.dark', testID: 'appearance-mode-dark' },
  { mode: ThemeMode.LIGHT, labelKey: 'appearance.mode.light', testID: 'appearance-mode-light' },
  { mode: ThemeMode.SYSTEM, labelKey: 'appearance.mode.system', testID: 'appearance-mode-system' },
];

export function ThemeModeSelector(): React.JSX.Element {
  const { t } = useTranslation('appearance');
  const { mode, setMode } = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.container} accessibilityRole="radiogroup" testID="theme-mode-selector">
      {MODE_OPTIONS.map((option) => {
        const isActive = option.mode === mode;
        return (
          <Pressable
            key={option.mode}
            style={[styles.option, isActive && styles.optionActive]}
            onPress={() => setMode(option.mode)}
            accessibilityRole="radio"
            accessibilityState={{ selected: isActive }}
            testID={option.testID}
          >
            <Text style={[styles.label, isActive && styles.labelActive]}>
              {t(option.labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  container: {
    flexDirection: 'row',
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: theme.border,
  },
  option: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
  },
  optionActive: {
    // Active-state emphasis via the accent token (not a page surface).
    backgroundColor: theme.accent,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.textSecondary,
  },
  labelActive: {
    color: theme.onAccent,
  },
}));
