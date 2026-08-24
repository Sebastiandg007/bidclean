/**
 * ChecklistEditor
 *
 * Add/remove/reorder text checklist items for a property.
 * Validates maximum item count (from constants) and character limit per item.
 * Uses move up/down buttons for reordering (same pattern as PhotoUploader).
 *
 * @see Task 32 — property-management spec
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
  CHECKLIST_ITEM_MAX_LENGTH,
  COLORS,
  FONT_SIZE,
  PROPERTY_MAX_CHECKLIST_ITEMS,
  SPACING,
} from '../properties.constants';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChecklistEditorProps {
  items: string[];
  onChange?: (items: string[]) => void;
}

// ─── Layout Constants ────────────────────────────────────────────────────────

const BADGE_BORDER_RADIUS = 6;
const ACTION_BUTTON_SIZE = 28;
const CONTAINER_BORDER_RADIUS = 12;
const CHAR_WARNING_THRESHOLD = 0.8;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Determine if the character count is near the limit */
function isNearCharLimit(length: number): boolean {
  return length >= CHECKLIST_ITEM_MAX_LENGTH * CHAR_WARNING_THRESHOLD;
}

/** Determine if the character count has reached the limit */
function isAtCharLimit(length: number): boolean {
  return length >= CHECKLIST_ITEM_MAX_LENGTH;
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

interface CountIndicatorProps {
  current: number;
  max: number;
}

/** Shows "X/MAX items" counter badge */
function CountIndicator({ current, max }: CountIndicatorProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.countContainer} testID="checklist-count-indicator">
      <Text style={styles.countText}>
        {t('properties.checklist.count', {
          defaultValue: '{{current}}/{{max}} items',
          current,
          max,
        })}
      </Text>
    </View>
  );
}

interface CharCounterProps {
  current: number;
  max: number;
}

/** Character counter label with warning/error color */
function CharCounter({ current, max }: CharCounterProps) {
  const { t } = useTranslation();
  const atLimit = isAtCharLimit(current);
  const nearLimit = isNearCharLimit(current);

  return (
    <Text
      style={[
        styles.charCounter,
        nearLimit && styles.charCounterWarning,
        atLimit && styles.charCounterError,
      ]}
      testID="checklist-char-counter"
    >
      {t('properties.checklist.char_limit', {
        defaultValue: '{{current}}/{{max}}',
        current,
        max,
      })}
    </Text>
  );
}

interface ReorderButtonsProps {
  index: number;
  total: number;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}

/** Move up/down buttons for reordering items */
function ReorderButtons({ index, total, onMoveUp, onMoveDown }: ReorderButtonsProps) {
  const { t } = useTranslation();
  const isFirst = index === 0;
  const isLast = index === total - 1;

  return (
    <View style={styles.reorderContainer}>
      <Pressable
        style={[styles.actionButton, isFirst && styles.actionButtonDisabled]}
        onPress={() => onMoveUp(index)}
        disabled={isFirst}
        accessibilityRole="button"
        accessibilityLabel={t('properties.checklist.move_up', {
          defaultValue: 'Move item up',
        })}
        accessibilityState={{ disabled: isFirst }}
        testID={`checklist-move-up-${index}`}
      >
        <Text style={[styles.actionIcon, isFirst && styles.actionIconDisabled]}>↑</Text>
      </Pressable>
      <Pressable
        style={[styles.actionButton, isLast && styles.actionButtonDisabled]}
        onPress={() => onMoveDown(index)}
        disabled={isLast}
        accessibilityRole="button"
        accessibilityLabel={t('properties.checklist.move_down', {
          defaultValue: 'Move item down',
        })}
        accessibilityState={{ disabled: isLast }}
        testID={`checklist-move-down-${index}`}
      >
        <Text style={[styles.actionIcon, isLast && styles.actionIconDisabled]}>↓</Text>
      </Pressable>
    </View>
  );
}

interface DeleteButtonProps {
  index: number;
  onDelete: (index: number) => void;
}

/** Delete button to remove an item */
function DeleteButton({ index, onDelete }: DeleteButtonProps) {
  const { t } = useTranslation();

  return (
    <Pressable
      style={styles.deleteButton}
      onPress={() => onDelete(index)}
      accessibilityRole="button"
      accessibilityLabel={t('properties.checklist.delete_a11y', {
        defaultValue: 'Remove checklist item',
      })}
      testID={`checklist-delete-${index}`}
    >
      <Text style={styles.deleteIcon}>✕</Text>
    </Pressable>
  );
}

interface ChecklistItemRowProps {
  text: string;
  index: number;
  total: number;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onDelete: (index: number) => void;
}

/** Single checklist item row with text, char count, reorder, and delete */
function ChecklistItemRow({
  text,
  index,
  total,
  onMoveUp,
  onMoveDown,
  onDelete,
}: ChecklistItemRowProps) {
  const { t } = useTranslation();

  return (
    <View
      style={styles.itemRow}
      accessibilityLabel={t('properties.checklist.item_a11y', {
        defaultValue: 'Checklist item {{index}}: {{text}}',
        index: index + 1,
        text,
      })}
      testID={`checklist-item-${index}`}
    >
      <View style={styles.itemContent}>
        <Text style={styles.itemText} numberOfLines={2}>
          {text}
        </Text>
        <CharCounter current={text.length} max={CHECKLIST_ITEM_MAX_LENGTH} />
      </View>
      <View style={styles.itemActions}>
        <ReorderButtons
          index={index}
          total={total}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
        />
        <DeleteButton index={index} onDelete={onDelete} />
      </View>
    </View>
  );
}

interface AddItemInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onAdd: () => void;
  isMaxReached: boolean;
}

/** Input row with text field and add button */
function AddItemInput({ value, onChangeText, onAdd, isMaxReached }: AddItemInputProps) {
  const { t } = useTranslation();
  const trimmed = value.trim();
  const isDisabled = isMaxReached || trimmed.length === 0 || isAtCharLimit(trimmed.length + 1);
  const canType = !isMaxReached;

  return (
    <View style={styles.addContainer}>
      <View style={styles.inputWrapper}>
        <TextInput
          style={[styles.textInput, isMaxReached && styles.textInputDisabled]}
          value={value}
          onChangeText={onChangeText}
          placeholder={t('properties.checklist.add_placeholder', {
            defaultValue: 'Add a task...',
          })}
          placeholderTextColor={COLORS.textSecondary}
          maxLength={CHECKLIST_ITEM_MAX_LENGTH}
          editable={canType}
          accessibilityLabel={t('properties.checklist.add_placeholder', {
            defaultValue: 'Add a task...',
          })}
          testID="checklist-input"
        />
        <CharCounter current={value.length} max={CHECKLIST_ITEM_MAX_LENGTH} />
      </View>
      <Pressable
        style={[styles.addButton, isDisabled && styles.addButtonDisabled]}
        onPress={onAdd}
        disabled={isDisabled}
        accessibilityRole="button"
        accessibilityLabel={t('properties.checklist.add_button', {
          defaultValue: 'Add',
        })}
        accessibilityState={{ disabled: isDisabled }}
        testID="checklist-add-button"
      >
        <Text style={[styles.addButtonText, isDisabled && styles.addButtonTextDisabled]}>
          {t('properties.checklist.add_button', { defaultValue: 'Add' })}
        </Text>
      </Pressable>
    </View>
  );
}

/** Empty state when no checklist items exist */
function EmptyState() {
  const { t } = useTranslation();

  return (
    <View style={styles.emptyState} testID="checklist-empty-state">
      <Text style={styles.emptyIcon}>📋</Text>
      <Text style={styles.emptyTitle}>
        {t('properties.checklist.empty_title', { defaultValue: 'No checklist items' })}
      </Text>
      <Text style={styles.emptySubtitle}>
        {t('properties.checklist.empty_subtitle', {
          defaultValue: 'Add tasks the cleaner should complete',
        })}
      </Text>
    </View>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

/**
 * Checklist editor with add, remove, and reorder functionality.
 *
 * @param items - Array of checklist item strings
 * @param onChange - Callback invoked with updated items array on any change
 */
export const ChecklistEditor: React.FC<ChecklistEditorProps> = ({
  items,
  onChange,
}) => {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState('');

  const itemCount = items.length;
  const isMaxReached = itemCount >= PROPERTY_MAX_CHECKLIST_ITEMS;

  const handleAdd = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    if (trimmed.length > CHECKLIST_ITEM_MAX_LENGTH) return;
    if (items.length >= PROPERTY_MAX_CHECKLIST_ITEMS) return;

    onChange?.([...items, trimmed]);
    setInputValue('');
  }, [inputValue, items, onChange]);

  const handleDelete = useCallback(
    (index: number) => {
      const updated = items.filter((_, i) => i !== index);
      onChange?.(updated);
    },
    [items, onChange],
  );

  const handleMoveUp = useCallback(
    (index: number) => {
      if (index <= 0) return;
      const reordered = [...items];
      [reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]];
      onChange?.(reordered);
    },
    [items, onChange],
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      if (index >= items.length - 1) return;
      const reordered = [...items];
      [reordered[index], reordered[index + 1]] = [reordered[index + 1], reordered[index]];
      onChange?.(reordered);
    },
    [items, onChange],
  );

  return (
    <View style={styles.container} testID="checklist-editor">
      <View style={styles.header}>
        <Text style={styles.sectionTitle}>
          {t('properties.checklist.title', { defaultValue: 'Checklist' })}
        </Text>
        <CountIndicator current={itemCount} max={PROPERTY_MAX_CHECKLIST_ITEMS} />
      </View>

      {itemCount === 0 && <EmptyState />}

      {itemCount > 0 && (
        <View style={styles.itemsList}>
          {items.map((item, index) => (
            <ChecklistItemRow
              key={`checklist-${index}`}
              text={item}
              index={index}
              total={itemCount}
              onMoveUp={handleMoveUp}
              onMoveDown={handleMoveDown}
              onDelete={handleDelete}
            />
          ))}
        </View>
      )}

      {isMaxReached && (
        <Text style={styles.limitReachedText} testID="checklist-limit-reached">
          {t('properties.checklist.limit_reached', {
            defaultValue: 'Maximum items reached',
          })}
        </Text>
      )}

      <AddItemInput
        value={inputValue}
        onChangeText={setInputValue}
        onAdd={handleAdd}
        isMaxReached={isMaxReached}
      />
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
  itemsList: {
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: SPACING.sm,
    padding: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  itemContent: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  itemText: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.subtitle,
    marginBottom: SPACING.xs,
  },
  itemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  reorderContainer: {
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  actionButton: {
    width: ACTION_BUTTON_SIZE,
    height: ACTION_BUTTON_SIZE,
    borderRadius: BADGE_BORDER_RADIUS,
    backgroundColor: COLORS.card,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionButtonDisabled: {
    opacity: 0.3,
  },
  actionIcon: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.label,
    fontWeight: '700',
  },
  actionIconDisabled: {
    color: COLORS.textSecondary,
  },
  deleteButton: {
    width: ACTION_BUTTON_SIZE,
    height: ACTION_BUTTON_SIZE,
    borderRadius: ACTION_BUTTON_SIZE / 2,
    backgroundColor: COLORS.errorSubtle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteIcon: {
    color: COLORS.error,
    fontSize: FONT_SIZE.caption,
    fontWeight: '700',
  },
  addContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  inputWrapper: {
    flex: 1,
  },
  textInput: {
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
  charCounter: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.caption,
    marginTop: SPACING.xs,
  },
  charCounterWarning: {
    color: COLORS.warning,
  },
  charCounterError: {
    color: COLORS.error,
  },
  limitReachedText: {
    color: COLORS.error,
    fontSize: FONT_SIZE.caption,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
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

export default ChecklistEditor;
