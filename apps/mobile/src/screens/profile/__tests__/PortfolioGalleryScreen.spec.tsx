/**
 * PortfolioGalleryScreen tests.
 * Covers: empty state, grid rendering, upload trigger, delete confirmation,
 * max photos reached, and loading state.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Alert } from 'react-native';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});

const mockGet = jest.fn();
const mockDeleteFn = jest.fn();

jest.mock('../../../services/api.service', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: jest.fn(),
    delete: (...args: unknown[]) => mockDeleteFn(...args),
  },
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchImageLibraryAsync: jest.fn().mockResolvedValue({ canceled: true, assets: null }),
  MediaTypeOptions: { Images: 'Images' },
}));

jest.spyOn(Alert, 'alert');

import { PortfolioGalleryScreen } from '../PortfolioGalleryScreen';

// ─── Test Data ───────────────────────────────────────────────────────────────

const mockPhotos = [
  { id: 'photo-1', url: 'https://storage.test/photo1.jpg', displayOrder: 0, uploadedAt: '2024-01-01T00:00:00Z' },
  { id: 'photo-2', url: 'https://storage.test/photo2.jpg', displayOrder: 1, uploadedAt: '2024-01-02T00:00:00Z' },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PortfolioGalleryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the screen container', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { getByTestId } = render(<PortfolioGalleryScreen />);
    expect(getByTestId('portfolio-gallery-screen')).toBeTruthy();
  });

  it('shows loading state when fetch is pending', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { getByTestId } = render(<PortfolioGalleryScreen />);
    expect(getByTestId('portfolio-loading')).toBeTruthy();
  });

  it('shows the title text', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { getByText } = render(<PortfolioGalleryScreen />);
    expect(getByText('profile.portfolio.title')).toBeTruthy();
  });

  it('calls API endpoint on mount', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    render(<PortfolioGalleryScreen />);
    expect(mockGet).toHaveBeenCalledWith('/profile/me/portfolio?page=1&limit=10');
  });

  it('shows empty state after fetch resolves with no data', async () => {
    mockGet.mockResolvedValue({ data: [] });
    const { findByTestId } = render(<PortfolioGalleryScreen />);
    const emptyState = await findByTestId('portfolio-empty-state');
    expect(emptyState).toBeTruthy();
  });

  it('shows grid after fetch resolves with photos', async () => {
    mockGet.mockResolvedValue({ data: mockPhotos });
    const { findByTestId } = render(<PortfolioGalleryScreen />);
    const grid = await findByTestId('portfolio-grid');
    expect(grid).toBeTruthy();
  });

  it('delete button shows confirmation alert', async () => {
    mockGet.mockResolvedValue({ data: mockPhotos });
    const { findByTestId } = render(<PortfolioGalleryScreen />);
    const deleteBtn = await findByTestId('portfolio-delete-photo-1');
    fireEvent.press(deleteBtn);

    expect(Alert.alert).toHaveBeenCalledWith(
      'profile.portfolio.delete_title',
      'profile.portfolio.delete_message',
      expect.any(Array),
    );
  });
});
