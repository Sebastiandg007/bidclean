/**
 * RequirementsChips
 *
 * Predefined chips for special requirements + custom text input.
 * Multi-select with max count validation from constants.
 * Visual distinction between predefined (solid border) and custom (dashed border) items.
 *
 * @see Task 33 — property-management spec
 */

import React, { useCallback, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  COLORS,
  FONT_SIZE,
  PREDEFINED_REQUIREMENTS,
  PROPERTY_MAX_REQUIREMENTS,
  SPACING,
} from '../properties.constants';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RequirementsChipsProps {
  selected: string[];
  onChange?: (requirements: string[]) => void;
}

// ─── Layout Constants ────────────────────────────────────────────────────────

const CHIP_BORDER_RADIUS = 20;
const BADGE_BORDER_RADIUS = 6;
const CONTAINER_BORDER_RADIUS = 12;
const CUSTOM_INPUT_MAX_LENGTH = 100;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Get predefined requirement values as a Set for fast lookup */
const predefinedValues = new Set(PREDEFINED_REQUIREMENTS.map((r) => r.value));

// ─── Sub-Components ──────────────────────────────────────────────────────────

interface CountIndicatorProps {
  current: number;
  max: number;
}

/** Shows "X/MAX requirements" counter badge */
function CountIndicator({ current, max }: CountIndicatorProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.countContainer} testID="requirements-count-indicator">
      <Text style={styles.countText}>
        {t('properties.requirements.count', {
          defaultValue: '{{current}}/{{max}} requirements',
          current,
          max,
        })}
      </Text>
    </View>
  );
}

interface PredefinedChipProps {
  value: string;
  labelKey: string;
  isSelected: boolean;
  isDisabled: boolean;
  onToggle: (value: string) => void;
}

/** A single predefined requirement chip with solid border styling */
function PredefinedChip({
  value,
  labelKey,
  isSelected,
  isDisabled,
  onToggle,
}: PredefinedChipProps) {
  const { t } = useTranslation();
  const label = t(labelKey, { defaultValue: value });

  return (
    <Pressable
      style={[
        styles.chip,
        styles.chipPredefined,
        isSelected && styles.chipSelected,
        isDisabled && !isSelected && styles.chipDisabled,
      ]}
      onPress={() => onToggle(value)}
      disabled={isDisabled && !isSelected}
      accessibilityRole="button"
      accessibilityLabel={t('properties.requirements.chip_a11y', {
        defaultValue: '{{label}}, {{state}}',
        label,
        state: isSelected
          ? t('properties.requirements.selected', { defaultValue: 'selected' })
          : t('properties.requirements.not_selected', { defaultValue: 'not selected' }),
      })}
      accessibilityState={{ selected: isSelected, disabled: isDisabled && !isSelected }}
      testID={`requirements-chip-${value}`}
    >
      <Text
        style={[
          styles.chipText,
          isSelected && styles.chipTextSelected,
          isDisabled && !isSelected && styles.chipTextDisabled,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

interface CustomChipProps {
  value: string;
  onRemove: (value: string) => void;
}

/** A custom requirement chip with dashed border styling */
function CustomChip({ value, onRemove }: CustomChipProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.customChipRow} testID={`requirements-custom-${value}`}>
      <View style={styles.customChipContent}>
        <Text style={styles.customChipText}>{value}</Text>
      </View>
      <Pressable
        style={styles.removeButton}
        onPress={() => onRemove(value)}
        accessibilityRole="button"
        accessibilityLabel={t('properties.requirements.remove_a11y', {
          defaultValue: 'Remove {{item}}',
          item: value,
        })}
        testID={`requirements-remove-${value}`}
      >
        <Text style={styles.removeIcon}>✕</Text>
      </Pressable>
    </View>
  );
}

interface CustomInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onAdd: () => void;
  isMaxReached: boolean;
}

/** Input row for adding custom requirements */
function CustomInput({ value, onChangeText, onAdd, isMaxReached }: CustomInputProps) {
  const { t } = useTranslation();
  const trimmed = value.trim();
  const isDisabled = isMaxReached || trimmed.length === 0;

  return (
    <View style={styles.inputContainer}>
      <TextInput
        style={[styles.textInput, isMaxReached && styles.textInputDisabled]}
        value={value}
        onChangeText={onChangeText}
        placeholder={t('properties.requirements.custom_placeholder', {
          defaultValue: 'Add custom requirement...',
        })}
        placeholderTextColor={COLORS.textSecondary}
        maxLength={CUSTOM_INPUT_MAX_LENGTH}
        editable={!isMaxReached}
        accessibilityLabel={t('properties.requirements.custom_placeholder', {
          defaultValue: 'Add custom requirement...',
        })}
        testID="requirements-custom-input"
      />
      <Pressable
        style={[styles.addButton, isDisabled && styles.addButtonDisabled]}
        onPress={onAdd}
        disabled={isDisabled}
        accessibilityRole="button"
        accessibilityLabel={t('properties.requirements.add_button', {
          defaultValue: 'Add',
        })}
        accessibilityState={{ disabled: isDisabled }}
        testID="requirements-add-button"
      >
        <Text style={[styles.addButtonText, isDisabled && styles.addButtonTextDisabled]}>
          {t('properties.requirements.add_button', { defaultValue: 'Add' })}
        </Text>
      </Pressable>
    </View>
  );
}

/** Empty state when no requirements are selected */
function EmptyState() {
  const { t } = useTranslation();

  return (
    <View style={styles.emptyState} testID="requirements-empty-state">
      <Text style={styles.emptyIcon}>📋</Text>
      <Text style={styles.emptyTitle}>
        {t('properties.requirements.empty_title', {
          defaultValue: 'No requirements selected',
        })}
      </Text>
      <Text style={styles.emptySubtitle}>
        {t('properties.requirements.empty_subtitle', {
          defaultValue: 'Select predefined or add custom requirements',
        })}
      </Text>
    </View>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

/**
 * Requirements chips with predefined options and custom text input.
 *
 * @param selected - Array of selected requirement values (predefined + custom)
 * @param onChange - Callback invoked with updated requirements array on any change
 */
export const RequirementsChips: React.FC<RequirementsChipsProps> = ({
  selected,
  onChange,
}) => {
  const { t } = useTranslation();
  const [customInput, setCustomInput] = useState('');

  const isMaxReached = selected.length >= PROPERTY_MAX_REQUIREMENTS;

  const customItems = selected.filter((val) => !predefinedValues.has(val));

  const handleTogglePredefined = useCallback(
    (value: string) => {
      const isSelected = selected.includes(value);
      if (isSelected) {
        onChange?.(selected.filter((v) => v !== value));
      } else {
        if (selected.length >= PROPERTY_MAX_REQUIREMENTS) return;
        onChange?.([...selected, value]);
      }
    },
    [selected, onChange],
  );

  const handleAddCustom = useCallback(() => {
    const trimmed = customInput.trim();
    if (!trimmed) return;
    if (selected.length >= PROPERTY_MAX_REQUIREMENTS) return;
    if (selected.includes(trimmed)) return;

    onChange?.([...selected, trimmed]);
    setCustomInput('');
  }, [customInput, selected, onChange]);

  const handleRemoveCustom = useCallback(
    (value: string) => {
      onChange?.(selected.filter((v) => v !== value));
    },
    [selected, onChange],
  );

  return (
    <View style={styles.container} testID="requirements-chips">
      <View style={styles.header}>
        <Text style={styles.sectionTitle}>
          {t('properties.requirements.title', { defaultValue: 'Special Requirements' })}
        </Text>
        <CountIndicator current={selected.length} max={PROPERTY_MAX_REQUIREMENTS} />
      </View>

      {selected.length === 0 && <EmptyState />}

      {/* Predefined chips section */}
      <View style={styles.chipsSection}>
        <Text style={styles.subsectionLabel}>
          {t('properties.requirements.predefined_label', { defaultValue: 'Common' })}
        </Text>
        <View style={styles.chipsGrid} testID="requirements-predefined-section">
          {PREDEFINED_REQUIREMENTS.map((req) => (
            <PredefinedChip
              key={req.value}
              value={req.value}
              labelKey={req.labelKey}
              isSelected={selected.includes(req.value)}
              isDisabled={isMaxReached}
              onToggle={handleTogglePredefined}
            />
          ))}
        </View>
      </View>

      {/* Custom requirements section */}
      <View style={styles.customSection}>
        <Text style={styles.subsectionLabel}>
          {t('properties.requirements.custom_label', { defaultValue: 'Custom' })}
        </Text>

        {customItems.length > 0 && (
          <View style={styles.customList} testID="requirements-custom-section">
            {customItems.map((item) => (
              <CustomChip key={item} value={item} onRemove={handleRemoveCustom} />
            ))}
          </View>
        )}

        <CustomInput
          value={customInput}
          onChangeText={setCustomInput}
          onAdd={handleAddCustom}
          isMaxReached={isMaxReached}
        />
      </View>

      {isMaxReached && (
        <Text style={styles.limitReachedText} testID="requirements-limit-reached">
          {t('properties.requirements.limit_reached', {
            defaultValue: 'Maximum requirements reached',
          })}
        </Text>
      )}
    </View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.card,
    borderRadius: CONTAINER_BORDER_RADIUS,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.body,
    fontWeight: '700',
  },
  countContainer: {
    backgroundColor: COLORS.accentSubtle,
    borderRadius: BADGE_BORDER_RADIUS,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  countText: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.caption,
    fontWeight: '600',
  },
  subsectionLabel: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.label,
    fontWeight: '600',
    marginBottom: SPACING.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipsSection: {
    marginBottom: SPACING.md,
  },
  chipsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  chip: {
    borderRadius: CHIP_BORDER_RADIUS,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderWidth: 1,
  },
  chipPredefined: {
    backgroundColor: COLORS.background,
    borderColor: COLORS.border,
  },
  chipSelected: {
    backgroundColor: COLORS.accentSubtle,
    borderColor: COLORS.accent,
  },
  chipDisabled: {
    opacity: 0.4,
  },
  chipText: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.subtitle,
    fontWeight: '500',
  },
  chipTextSelected: {
    color: COLORS.accent,
    fontWeight: '600',
  },
  chipTextDisabled: {
    color: COLORS.textSecondary,
  },
  customSection: {
    marginBottom: SPACING.sm,
  },
  customList: {
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  customChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  customChipContent: {
    flex: 1,
  },
  customChipText: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.subtitle,
  },
  removeButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.errorSubtle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeIcon: {
    color: COLORS.error,
    fontSize: FONT_SIZE.caption,
    fontWeight: '700',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  textInput: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderRadius: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.subtitle,
  },
  textInputDisabled: {
    opacity: 0.5,
  },
  addButton: {
    borderWidth: 2,
    borderColor: COLORS.accent,
    borderStyle: 'dashed',
    borderRadius: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonDisabled: {
    borderColor: COLORS.border,
  },
  addButtonText: {
    color: COLORS.accent,
    fontSize: FONT_SIZE.subtitle,
    fontWeight: '600',
  },
  addButtonTextDisabled: {
    color: COLORS.textSecondary,
  },
  limitReachedText: {
    color: COLORS.error,
    fontSize: FONT_SIZE.caption,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: SPACING.lg,
    marginBottom: SPACING.md,
  },
  emptyIcon: {
    fontSize: FONT_SIZE.icon,
    marginBottom: SPACING.sm,
  },
  emptyTitle: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.body,
    fontWeight: '600',
    marginBottom: SPACING.xs,
  },
  emptySubtitle: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.subtitle,
    textAlign: 'center',
  },
});

export default RequirementsChips;
