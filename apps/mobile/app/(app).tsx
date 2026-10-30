/**
 * app/(app).tsx — the authenticated app shell.
 *
 * Mounts the existing RoleBasedNavigator, which renders the Host or Cleaner tab
 * navigator based on the active role (and redirects to role selection when none
 * is set). Reached once a session + active role exist.
 */

import React from 'react';

import RoleBasedNavigator from '../src/navigation/RoleBasedNavigator';

export default function AppShell(): React.JSX.Element {
  return <RoleBasedNavigator />;
}
