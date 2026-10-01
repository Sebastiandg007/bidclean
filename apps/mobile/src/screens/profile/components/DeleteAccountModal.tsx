/**
 * DeleteAccountModal — Confirmation dialog for account deletion.
 * User must type a confirmation word to proceed.
 * Warns that deletion is irreversible.
 */

import React, { useState, useCallback } from 'react';
import {
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { makeStyles, useTheme } from '../../../theme';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const SPACING = {
  sm: 8,
  md: 16,
  lg: 24,
} as const;

const FONT_SIZE = {
  sm: 14,
  md: 16,
  lg: 20,
} as const;

const BORDER_RADIUS_MODAL = 16;
const BORDER_RADIUS_INPUT = 8;
const BORDER_RADIUS_BUTTON = 8;
const MODAL_MAX_WIDTH = 360;

/**
 * Confirmation word the user must type to confirm deletion.
 * Server-side the word is configurable via PROFILE_DELETE_CONFIRMATION_WORD env var.
 * Client-side we use the same default for UI validation before submission.
 */
const CONFIRMATION_WORD = 'DELETE';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DeleteAccountModalProps {
  visible: boolean;
  isLoading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DeleteAccountModal({
  visible,
  isLoading,
  onConfirm,
  onCancel,
}: DeleteAccountModalProps): React.JSX.Element {
  const { t } = useTranslation();
  const styles = useStyles();
  const { theme } = useTheme();
  const [inputValue, setInputValue] = useState('');

  const isConfirmEnabled = inputValue === CONFIRMATION_WORD && !isLoading;

  const handleCancel = useCallback(() => {
    setInputValue('');
    onCancel();
  }, [onCancel]);

  const handleConfirm = useCallback(() => {
    if (!isConfirmEnabled) return;
    onConfirm();
  }, [isConfirmEnabled, onConfirm]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
      testID="delete-account-modal"
    >
      <Pressable style={styles.overlay} onPress={handleCancel}>
        <View
          style={styles.modalContent}
          onStartShouldSetResponder={() => true}
        >
          <Text style={styles.title}>
            {t('profile.account.delete_modal.title')}
          </Text>

          <Text style={styles.warning}>
            {t('profile.account.delete_modal.warning')}
          </Text>

          <Text style={styles.confirmationLabel}>
            {t('profile.account.delete_modal.confirmation_label')}
          </Text>

          <TextInput
            style={styles.input}
            value={inputValue}
            onChangeText={setInputValue}
            placeholder={t('profile.account.delete_modal.confirmation_placeholder')}
            placeholderTextColor={theme.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            testID="delete-confirmation-input"
          />

          <View style={styles.buttonRow}>
            <Pressable
              style={styles.cancelButton}
              onPress={handleCancel}
              testID="delete-modal-cancel"
            >
              <Text style={styles.cancelButtonText}>
                {t('profile.account.delete_modal.cancel')}
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.confirmButton,
                !isConfirmEnabled && styles.confirmButtonDisabled,
              ]}
              onPress={handleConfirm}
              disabled={!isConfirmEnabled}
              testID="delete-modal-confirm"
            >
              <Text
                style={[
                  styles.confirmButtonText,
                  !isConfirmEnabled && styles.confirmButtonTextDisabled,
                ]}
              >
                {t('profile.account.delete_modal.confirm')}
              </Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles((theme) => ({
  overlay: {
    flex: 1,
    backgroundColor: theme.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalContent: {
    backgroundColor: theme.surface,
    borderRadius: BORDER_RADIUS_MODAL,
    padding: SPACING.lg,
    width: '100%',
    maxWidth: MODAL_MAX_WIDTH,
  },
  title: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
    color: theme.textPrimary,
    marginBottom: SPACING.md,
  },
  warning: {
    fontSize: FONT_SIZE.sm,
    color: theme.danger,
    lineHeight: 20,
    marginBottom: SPACING.md,
  },
  confirmationLabel: {
    fontSize: FONT_SIZE.sm,
    color: theme.textSecondary,
    marginBottom: SPACING.sm,
  },
  input: {
    backgroundColor: theme.surfaceElevated,
    borderRadius: BORDER_RADIUS_INPUT,
    padding: SPACING.md,
    fontSize: FONT_SIZE.md,
    color: theme.textPrimary,
    borderWidth: 1,
    borderColor: theme.border,
    marginBottom: SPACING.lg,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS_BUTTON,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: FONT_SIZE.md,
    color: theme.textSecondary,
    fontWeight: '600',
  },
  confirmButton: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS_BUTTON,
    backgroundColor: theme.danger,
    alignItems: 'center',
  },
  confirmButtonDisabled: {
    backgroundColor: theme.surfaceElevated,
  },
  confirmButtonText: {
    fontSize: FONT_SIZE.md,
    color: theme.textPrimary,
    fontWeight: '600',
  },
  confirmButtonTextDisabled: {
    color: theme.textSecondary,
  },
}));

export default DeleteAccountModal;
