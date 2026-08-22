/**
 * Manual mock for expo-image-picker (not installed in dev dependencies).
 * Used by PortfolioGalleryScreen tests.
 */

export const MediaTypeOptions = {
  Images: 'Images',
  Videos: 'Videos',
  All: 'All',
} as const;

export async function requestMediaLibraryPermissionsAsync() {
  return { granted: true, status: 'granted' };
}

export async function launchImageLibraryAsync() {
  return { canceled: true, assets: null };
}

export async function requestCameraPermissionsAsync() {
  return { granted: true, status: 'granted' };
}

export async function launchCameraAsync() {
  return { canceled: true, assets: null };
}
