/**
 * DateRangeFilter — Quick-pick date filter with custom date picker option.
 *
 * Quick picks: Today, Tomorrow, This Week.
 * "Custom" opens a date picker modal for manual range selection.
 * Updates store via setFilters({ scheduledAfter, scheduledBefore }).
 *
 * Requirements: 5.1
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { useRadarStore } from '../../useRadarStore';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  background: '#0B0C10',
  card: '#1F2833',
  accent: '#00F5D4',
  accentSubtle: 'rgba(0, 245, 212, 0.12)',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.6)',
  chipBorder: 'rgba(255, 255, 255, 0.15)',
  chipSelectedBorder: '#00F5D4',
  overlay: 'rgba(0, 0, 0, 0.6)',
  inputBorder: 'rgba(255, 255, 255, 0.2)',
} as const;

const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

const FONT_SIZE = {
  label: 16,
  chip: 13,
  input: 14,
  button: 14,
} as const;

// ─── Constants ───────────────────────────────────────────────────────────────

const CHIP_BORDER_RADIUS = 20;
const CHIP_BORDER_WIDTH = 1;
const INPUT_BORDER_RADIUS = 8;
const INPUT_BORDER_WIDTH = 1;
const MODAL_BORDER_RADIUS = 16;
const BUTTON_BORDER_RADIUS = 8;
const ACTIVE_OPACITY = 0.7;

/** Quick pick identifiers */
type QuickPick = 'today' | 'tomorrow' | 'thisWeek' | 'custom';

const QUICK_PICKS: QuickPick[] = ['today', 'tomorrow', 'thisWeek', 'custom'];

/** Maps quick pick IDs to i18n keys */
const QUICK_PICK_I18N_KEYS: Record<QuickPick, string> = {
  today: 'filter.dateRange.today',
  tomorrow: 'filter.dateRange.tomorrow',
  thisWeek: 'filter.dateRange.thisWeek',
  custom: 'filter.dateRange.custom',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getStartOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getEndOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function getDateRange(pick: Exclude<QuickPick, 'custom'>): { after: string; before: string } {
  const now = new Date();

  switch (pick) {
    case 'today': {
      return {
        after: getStartOfDay(now).toISOString(),
        before: getEndOfDay(now).toISOString(),
      };
    }
    case 'tomorrow': {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return {
        after: getStartOfDay(tomorrow).toISOString(),
        before: getEndOfDay(tomorrow).toISOString(),
      };
    }
    case 'thisWeek': {
      const dayOfWeek = now.getDay();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - dayOfWeek);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      return {
        after: getStartOfDay(startOfWeek).toISOString(),
        before: getEndOfDay(endOfWeek).toISOString(),
      };
    }
  }
}

function getActiveQuickPick(after: string | null, before: string | null): QuickPick | null {
  if (!after || !before) return null;

  for (const pick of ['today', 'tomorrow', 'thisWeek'] as const) {
    const range = getDateRange(pick);
    if (range.after === after && range.before === before) {
      return pick;
    }
  }

  return 'custom';
}

function formatDateForInput(isoString: string | null): string {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return '';
  }
}

function parseDateInput(dateStr: string): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  return date.toISOString();
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DateRangeFilter(): React.JSX.Element {
  const { t } = useTranslation('radar');
  const scheduledAfter = useRadarStore((state) => state.filters.scheduledAfter);
  const scheduledBefore = useRadarStore((state) => state.filters.scheduledBefore);
  const setFilters = useRadarStore((state) => state.setFilters);

  const [customModalVisible, setCustomModalVisible] = useState(false);
  const [customAfter, setCustomAfter] = useState('');
  const [customBefore, setCustomBefore] = useState('');

  const activePick = useMemo(
    () => getActiveQuickPick(scheduledAfter, scheduledBefore),
    [scheduledAfter, scheduledBefore],
  );

  const handleQuickPick = useCallback(
    (pick: QuickPick) => {
      if (pick === 'custom') {
        setCustomAfter(formatDateForInput(scheduledAfter));
        setCustomBefore(formatDateForInput(scheduledBefore));
        setCustomModalVisible(true);
        return;
      }

      // If already active, deselect (clear filter)
      if (activePick === pick) {
        setFilters({ scheduledAfter: null, scheduledBefore: null });
        return;
      }

      const range = getDateRange(pick);
      setFilters({ scheduledAfter: range.after, scheduledBefore: range.before });
    },
    [activePick, scheduledAfter, scheduledBefore, setFilters],
  );

  const handleCustomApply = useCallback(() => {
    const parsedAfter = parseDateInput(customAfter);
    const parsedBefore = parseDateInput(customBefore);

    if (parsedAfter || parsedBefore) {
      setFilters({
        scheduledAfter: parsedAfter ? getStartOfDay(new Date(parsedAfter)).toISOString() : null,
        scheduledBefore: parsedBefore ? getEndOfDay(new Date(parsedBefore)).toISOString() : null,
      });
    }

    setCustomModalVisible(false);
  }, [customAfter, customBefore, setFilters]);

  const handleCustomCancel = useCallback(() => {
    setCustomModalVisible(false);
  }, []);

  return (
    <View style={styles.container} testID="date-range-filter">
      <Text style={styles.label}>{t('filter.dateRange.label')}</Text>

      <View style={styles.chipContainer}>
        {QUICK_PICKS.map((pick) => {
          const isSelected = activePick === pick;

          return (
            <TouchableOpacity
              key={pick}
              style={[styles.chip, isSelected && styles.chipSelected]}
              onPress={() => handleQuickPick(pick)}
              activeOpacity={ACTIVE_OPACITY}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={t(QUICK_PICK_I18N_KEYS[pick])}
              testID={`date-filter-${pick}`}
            >
              <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                {t(QUICK_PICK_I18N_KEYS[pick])}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Custom Date Picker Modal */}
      <Modal
        visible={customModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCustomCancel}
        testID="custom-date-modal"
      >
        <Pressable style={styles.modalOverlay} onPress={handleCustomCancel}>
          <View />
        </Pressable>

        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('filter.dateRange.custom')}</Text>

            {/* From date */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('filter.priceRange.min')}</Text>
              <TextInput
                style={styles.dateInput}
                value={customAfter}
                onChangeText={setCustomAfter}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={COLORS.textSecondary}
                keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
                testID="custom-date-after-input"
              />
            </View>

            {/* To date */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('filter.priceRange.max')}</Text>
              <TextInput
                style={styles.dateInput}
                value={customBefore}
                onChangeText={setCustomBefore}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={COLORS.textSecondary}
                keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
                testID="custom-date-before-input"
              />
            </View>

            {/* Actions */}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={handleCustomCancel}
                accessibilityRole="button"
                testID="custom-date-cancel"
              >
                <Text style={styles.cancelButtonText}>{t('filter.clearAll')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.applyButton}
                onPress={handleCustomApply}
                accessibilityRole="button"
                testID="custom-date-apply"
              >
                <Text style={styles.applyButtonText}>{t('filter.apply')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  label: {
    fontSize: FONT_SIZE.label,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  chip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: CHIP_BORDER_RADIUS,
    borderWidth: CHIP_BORDER_WIDTH,
    borderColor: COLORS.chipBorder,
    backgroundColor: 'transparent',
  },
  chipSelected: {
    borderColor: COLORS.chipSelectedBorder,
    backgroundColor: COLORS.accentSubtle,
  },
  chipText: {
    fontSize: FONT_SIZE.chip,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  chipTextSelected: {
    color: COLORS.accent,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
  },
  modalContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    top: 0,
  },
  modalContent: {
    backgroundColor: COLORS.card,
    borderRadius: MODAL_BORDER_RADIUS,
    padding: SPACING.xl,
    marginHorizontal: SPACING.lg,
    width: '85%',
    maxWidth: 360,
  },
  modalTitle: {
    fontSize: FONT_SIZE.label,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.lg,
    textAlign: 'center',
  },
  inputGroup: {
    marginBottom: SPACING.lg,
  },
  inputLabel: {
    fontSize: FONT_SIZE.chip,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  dateInput: {
    borderWidth: INPUT_BORDER_WIDTH,
    borderColor: COLORS.inputBorder,
    borderRadius: INPUT_BORDER_RADIUS,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.input,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: SPACING.md,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: BUTTON_BORDER_RADIUS,
    alignItems: 'center',
    marginRight: SPACING.sm,
  },
  cancelButtonText: {
    fontSize: FONT_SIZE.button,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  applyButton: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: BUTTON_BORDER_RADIUS,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    marginLeft: SPACING.sm,
  },
  applyButtonText: {
    fontSize: FONT_SIZE.button,
    color: COLORS.background,
    fontWeight: '700',
  },
});

export default DateRangeFilter;
