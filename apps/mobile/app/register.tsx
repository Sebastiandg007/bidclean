/**
 * app/register.tsx — registration route.
 *
 * Mounts the existing RegisterScreen. On continue it routes into role selection
 * (the next step of onboarding).
 */

import React from 'react';
import { useRouter } from 'expo-router';

import RegisterScreen from '../src/screens/auth/RegisterScreen';

export default function RegisterRoute(): React.JSX.Element {
  const router = useRouter();
  return <RegisterScreen onContinue={() => router.push('/roles/selection')} />;
}
