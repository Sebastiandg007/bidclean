/**
 * app/home.tsx — the authenticated app shell route.
 *
 * Mounts the existing RoleBasedNavigator, which renders the Host or Cleaner tab
 * navigator based on the active role (and redirects to role selection when none
 * is set). Reached once a session + active role exist.
 */

import React from 'react';

import RoleBasedNavigator from '../src/navigation/RoleBasedNavigator';

export default function HomeShell(): React.JSX.Element {
  return <RoleBasedNavigator />;
}
