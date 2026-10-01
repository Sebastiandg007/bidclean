/**
 * NotificationSettingsScreen — toggle notification categories and quiet hours.
 *
 * Reads/writes the caller's preferences via the notifications store (backend-persisted). Uses the
 * BidClean semantic theme tokens via `useThemedStyles`/`useTheme` and i18n keys (en/es parity). No
 * business text is hardcoded; every label is a `t(...)` key.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useNotificationsStore } from './notifications.store';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATIONS_I18N_KEYS,
  type NotificationCategory,
} from './notifications.constants';
import type { NotificationPreferences } from './notifications.types';
import { makeStyles, useTheme } from '../../theme';

const SPACING = { sm: 8, md: 16, lg: 24 } as const;

/** A single category opt-in toggle row. */
function CategoryRow({
  category,
  enabled,
  onToggle,
}: {
  category: NotificationCategory;
  enabled: boolean;
  onToggle: (next: boolean) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const styles = useStyles();
  const { theme } = useTheme();
  return (
    <View style={styles.row} testID={`category-row-${category}`}>
      <Text style={styles.rowLabel}>{t(NOTIFICATIONS_I18N_KEYS.CATEGORY[category])}</Text>
      <Switch
        testID={`category-switch-${category}`}
        value={enabled}
        onValueChange={onToggle}
        trackColor={{ false: theme.textMuted, true: theme.accent }}
      />
    </View>
  );
}

export function NotificationSettingsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const styles = useStyles();
  const preferences = useNotificationsStore((state) => state.preferences);
  const loadPreferences = useNotificationsStore((state) => state.loadPreferences);
  const savePreferences = useNotificationsStore((state) => state.savePreferences);
  const isSaving = useNotificationsStore((state) => state.isSavingPreferences);

  const [draft, setDraft] = useState<NotificationPreferences>(preferences);

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  useEffect(() => {
    setDraft(preferences);
  }, [preferences]);

  const categoryEnabled = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const category of NOTIFICATION_CATEGORIES) {
      // Absent override => enabled by default (mirrors backend metadata defaultEnabled).
      map[category] = draft.categoryOptOut[category] !== false;
    }
    return map;
  }, [draft.categoryOptOut]);

  const toggleCategory = (category: NotificationCategory, enabled: boolean): void => {
    const nextOptOut = { ...draft.categoryOptOut };
    if (enabled) {
      delete nextOptOut[category];
    } else {
      nextOptOut[category] = false;
    }
    setDraft({ ...draft, categoryOptOut: nextOptOut });
  };

  const onSave = (): void => {
    void savePreferences(draft);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="notification-settings">
      <Text style={styles.title}>{t(NOTIFICATIONS_I18N_KEYS.SETTINGS_TITLE)}</Text>

      <Text style={styles.sectionTitle}>{t(NOTIFICATIONS_I18N_KEYS.CATEGORIES_TITLE)}</Text>
      {NOTIFICATION_CATEGORIES.map((category) => (
        <CategoryRow
          key={category}
          category={category}
          enabled={categoryEnabled[category] ?? true}
          onToggle={(next) => toggleCategory(category, next)}
        />
      ))}

      <Text style={styles.sectionTitle}>{t(NOTIFICATIONS_I18N_KEYS.QUIET_HOURS_TITLE)}</Text>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>{t(NOTIFICATIONS_I18N_KEYS.QUIET_HOURS_START)}</Text>
        <Text style={styles.rowValue}>{draft.quietHoursStart ?? '—'}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>{t(NOTIFICATIONS_I18N_KEYS.QUIET_HOURS_END)}</Text>
        <Text style={styles.rowValue}>{draft.quietHoursEnd ?? '—'}</Text>
      </View>

      <TouchableOpacity
        testID="save-preferences"
        style={styles.saveButton}
        onPress={onSave}
        disabled={isSaving}
        accessibilityRole="button"
      >
        <Text style={styles.saveButtonText}>{t(NOTIFICATIONS_I18N_KEYS.SAVE)}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const useStyles = makeStyles((theme) => ({
  screen: { flex: 1, backgroundColor: theme.background },
  content: { padding: SPACING.lg },
  title: { color: theme.textPrimary, fontSize: 24, fontWeight: '700', marginBottom: SPACING.lg },
  sectionTitle: {
    color: theme.textMuted,
    fontSize: 14,
    textTransform: 'uppercase',
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.surface,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    borderRadius: 12,
    marginBottom: SPACING.sm,
  },
  rowLabel: { color: theme.textPrimary, fontSize: 16 },
  rowValue: { color: theme.textMuted, fontSize: 16 },
  saveButton: {
    backgroundColor: theme.accent,
    paddingVertical: SPACING.md,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: SPACING.lg,
  },
  saveButtonText: { color: theme.onAccent, fontSize: 16, fontWeight: '700' },
}));

export default NotificationSettingsScreen;
