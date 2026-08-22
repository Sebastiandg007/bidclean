/**
 * SettingsItem — Reusable settings row component.
 *
 * Supports two modes:
 * - Toggle mode: displays a Switch for boolean preferences
 * - Selector mode: shows current value, pressable for selection
 */

import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  card: '#1F2833',
  textPrimary: '#FFFFFF',
  textSecondary: '#C5C6C7',
  accent: '#00F5D4',
  border: '#3A4250',
} as const;

const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
} as const;

const FONT_SIZE = {
  sm: 14,
  md: 16,
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

interface BaseProps {
  label: string;
  icon?: string;
  testID?: string;
}

interface ToggleProps extends BaseProps {
  mode: 'toggle';
  value: boolean;
  onValueChange: (value: boolean) => void;
}

interface SelectorProps extends BaseProps {
  mode: 'selector';
  displayValue: string;
  onPress: () => void;
}

export type SettingsItemProps = ToggleProps | SelectorProps;

// ─── Component ───────────────────────────────────────────────────────────────

export function SettingsItem(props: SettingsItemProps): React.JSX.Element {
  const { label, icon, testID } = props;

  if (props.mode === 'toggle') {
    return (
      <View style={styles.row} testID={testID}>
        <View style={styles.labelContainer}>
          {icon && <Text style={styles.icon}>{icon}</Text>}
          <Text style={styles.label}>{label}</Text>
        </View>
        <Switch
          value={props.value}
          onValueChange={props.onValueChange}
          trackColor={{ false: COLORS.border, true: COLORS.accent }}
          thumbColor={COLORS.textPrimary}
          testID={testID ? `${testID}-switch` : undefined}
        />
      </View>
    );
  }

  return (
    <Pressable style={styles.row} onPress={props.onPress} testID={testID}>
      <View style={styles.labelContainer}>
        {icon && <Text style={styles.icon}>{icon}</Text>}
        <Text style={styles.label}>{label}</Text>
      </View>
      <View style={styles.valueContainer}>
        <Text style={styles.value}>{props.displayValue}</Text>
        <Text style={styles.chevron}>›</Text>
      </View>
    </Pressable>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  labelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  icon: {
    fontSize: FONT_SIZE.md,
    marginRight: SPACING.sm,
  },
  label: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textPrimary,
  },
  valueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  value: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    marginRight: SPACING.xs,
  },
  chevron: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textSecondary,
  },
});

export default SettingsItem;
