/**
 * app/roles/selection.tsx — role selection route.
 *
 * Mounts the existing RoleSelectionScreen. The screen owns its own submit/router
 * logic; this route file just places it in the expo-router tree.
 */

import React from 'react';

import RoleSelectionScreen from '../../src/screens/roles/RoleSelectionScreen';

export default function RoleSelectionRoute(): React.JSX.Element {
  return <RoleSelectionScreen />;
}
