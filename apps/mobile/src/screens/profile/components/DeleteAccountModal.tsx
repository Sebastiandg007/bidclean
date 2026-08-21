/**
 * DeleteAccountModal — Confirmation dialog for account deletion.
 * User must type a confirmation word (from env config) to proceed.
 * Warns that deletion is irreversible.
 */

// TODO: Implement in task 31

import React from 'react';
import { View, Text } from 'react-native';

interface DeleteAccountModalProps {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteAccountModal({ visible }: DeleteAccountModalProps): React.JSX.Element | null {
  if (!visible) return null;

  // TODO: Render modal with warning text (i18n)
  // TODO: Render confirmation word input
  // TODO: Enable confirm button only when word matches
  return (
    <View>
      <Text>DeleteAccountModal</Text>
    </View>
  );
}

export default DeleteAccountModal;
