/**
 * PublicProfileScreen — Viewing another user's public profile.
 * Displays only public fields via dedicated endpoint.
 * Handles signed URL expiry for profile photos.
 */

// TODO: Implement in task 33

import React from 'react';
import { View, Text } from 'react-native';

export function PublicProfileScreen(): React.JSX.Element {
  // TODO: Fetch public profile via GET /profile/:userId
  // TODO: Display public fields only (name, photo, bio, specialties, etc.)
  // TODO: Handle signed URL expiry via useSignedUrl hook
  // TODO: Show KYC badge if verified
  return (
    <View>
      <Text>PublicProfileScreen</Text>
    </View>
  );
}

export default PublicProfileScreen;
