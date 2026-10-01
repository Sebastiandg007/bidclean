/**
 * ConfirmDisputeActions — the Host's confirm + dispute affordances (Spec 20).
 *
 * The confirm CTA uses the BidClean accent; the dispute action is a secondary/destructive path.
 * Both are disabled while a submission is in flight. All copy via i18n.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { COMPLETION_COLORS, COMPLETION_I18N_KEYS } from '../completion.constants';

export interface ConfirmDisputeActionsProps {
  readonly disabled: boolean;
  readonly onConfirm: () => void;
  readonly onDispute: () => void;
}

export function ConfirmDisputeActions({
  disabled,
  onConfirm,
  onDispute,
}: ConfirmDisputeActionsProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.container} testID="confirm-dispute-actions">
      <TouchableOpacity
        style={[styles.confirm, disabled && styles.disabled]}
        onPress={onConfirm}
        disabled={disabled}
        testID="completion-confirm"
      >
        <Text style={styles.confirmText}>{t(COMPLETION_I18N_KEYS.CONFIRM)}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.dispute, disabled && styles.disabled]}
        onPress={onDispute}
        disabled={disabled}
        testID="completion-dispute"
      >
        <Text style={styles.disputeText}>{t(COMPLETION_I18N_KEYS.DISPUTE)}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  confirm: {
    backgroundColor: COMPLETION_COLORS.ACCENT,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  confirmText: {
    color: COMPLETION_COLORS.BACKGROUND,
    fontSize: 16,
    fontWeight: '700',
  },
  dispute: {
    borderColor: COMPLETION_COLORS.DANGER,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  disputeText: {
    color: COMPLETION_COLORS.DANGER,
    fontSize: 15,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
  },
});
