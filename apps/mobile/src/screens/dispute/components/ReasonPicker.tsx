/**
 * ReasonPicker — the Host's dispute reason selector + optional text (Spec 21).
 *
 * The reason is gathered here for the Spec 20 completion flow that creates the dispute; this
 * component does not itself create the case. Dark BidClean tokens; all copy via i18n.
 */

import React from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { DISPUTE_COLORS, DISPUTE_I18N_KEYS } from '../dispute.constants';

export interface ReasonPickerProps {
  readonly reasonCodes: readonly string[];
  readonly selected: string | null;
  readonly text: string;
  readonly onSelect: (code: string) => void;
  readonly onChangeText: (text: string) => void;
}

export function ReasonPicker({
  reasonCodes,
  selected,
  text,
  onSelect,
  onChangeText,
}: ReasonPickerProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.container} testID="dispute-reason-picker">
      <Text style={styles.label}>{t(DISPUTE_I18N_KEYS.REASON_LABEL)}</Text>
      <View style={styles.chips}>
        {reasonCodes.map((code) => {
          const isActive = code === selected;
          return (
            <TouchableOpacity
              key={code}
              testID={`dispute-reason-${code}`}
              style={[styles.chip, isActive && styles.chipActive]}
              onPress={() => onSelect(code)}
            >
              <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{code}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <TextInput
        style={styles.input}
        testID="dispute-reason-text"
        placeholder={t(DISPUTE_I18N_KEYS.REASON_TEXT_PLACEHOLDER)}
        placeholderTextColor={DISPUTE_COLORS.TEXT_SECONDARY}
        value={text}
        onChangeText={onChangeText}
        multiline
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  label: { color: DISPUTE_COLORS.TEXT, fontSize: 15, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: DISPUTE_COLORS.CARD,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: DISPUTE_COLORS.ACCENT },
  chipText: { color: DISPUTE_COLORS.TEXT_SECONDARY, fontSize: 13 },
  chipTextActive: { color: DISPUTE_COLORS.BACKGROUND, fontWeight: '700' },
  input: {
    backgroundColor: DISPUTE_COLORS.CARD,
    borderRadius: 12,
    color: DISPUTE_COLORS.TEXT,
    minHeight: 80,
    padding: 12,
    textAlignVertical: 'top',
  },
});
