/**
 * PublicProfileScreen tests.
 * Covers: public fields display, signed URL handling, no private data leak,
 * KYC badge, portfolio gallery, loading/error states, business name for hosts.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params && 'date' in params) return `${key}__${params.date}`;
      return key;
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});

const mockUseLocalSearchParams = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

const mockGet = jest.fn();
jest.mock('../../../services/api.service', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

const mockUseSignedUrl = jest.fn();
jest.mock('../useSignedUrl', () => ({
  useSignedUrl: (url: string | null) => mockUseSignedUrl(url),
}));

import { PublicProfileScreen } from '../PublicProfileScreen';

// ─── Test Data ───────────────────────────────────────────────────────────────

const cleanerProfile = {
  userId: 'user-123',
  displayName: 'Maria Garcia',
  photoUrl: 'https://storage.test/photo.jpg?X-Amz-Date=20240101T120000Z&X-Amz-Expires=3600',
  memberSince: '2023-06-15T00:00:00Z',
  bio: 'Professional cleaner with 5 years of experience.',
  specialties: ['deep_cleaning', 'eco_friendly', 'window_cleaning'],
  workZoneLabel: 'Downtown, Bogotá',
  kycBadge: true,
  averageRating: 4.8,
  completedServicesCount: 42,
  portfolioPhotos: [
    { id: 'p1', url: 'https://storage.test/port1.jpg', displayOrder: 0, uploadedAt: '2024-01-01T00:00:00Z' },
    { id: 'p2', url: 'https://storage.test/port2.jpg', displayOrder: 1, uploadedAt: '2024-01-02T00:00:00Z' },
  ],
};

const hostProfile = {
  userId: 'user-456',
  displayName: 'John Smith',
  photoUrl: null,
  memberSince: '2024-01-01T00:00:00Z',
  businessName: 'Smith Properties LLC',
  averageRating: 4.5,
  completedServicesCount: 15,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PublicProfileScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({ userId: 'user-123' });
    mockUseSignedUrl.mockImplementation((url: string | null) => url);
  });

  describe('Loading state', () => {
    it('shows loading state while fetching', () => {
      mockGet.mockReturnValue(new Promise(() => {}));
      const { getByTestId } = render(<PublicProfileScreen />);
      expect(getByTestId('public-profile-loading')).toBeTruthy();
    });

    it('displays loading text', () => {
      mockGet.mockReturnValue(new Promise(() => {}));
      const { getByText } = render(<PublicProfileScreen />);
      expect(getByText('profile.public.loading')).toBeTruthy();
    });
  });

  describe('Error state', () => {
    it('shows error state on fetch failure', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));
      const { findByTestId } = render(<PublicProfileScreen />);
      const errorView = await findByTestId('public-profile-error');
      expect(errorView).toBeTruthy();
    });

    it('displays error message text', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));
      const { findByText } = render(<PublicProfileScreen />);
      const errorText = await findByText('profile.public.error');
      expect(errorText).toBeTruthy();
    });

    it('shows not found when userId is missing', async () => {
      mockUseLocalSearchParams.mockReturnValue({});
      const { findByTestId } = render(<PublicProfileScreen />);
      const notFound = await findByTestId('public-profile-error');
      expect(notFound).toBeTruthy();
    });
  });

  describe('Data fetching', () => {
    it('fetches public profile by userId', () => {
      mockGet.mockReturnValue(new Promise(() => {}));
      render(<PublicProfileScreen />);
      expect(mockGet).toHaveBeenCalledWith('/profile/user-123');
    });

    it('uses the correct userId from route params', () => {
      mockUseLocalSearchParams.mockReturnValue({ userId: 'user-456' });
      mockGet.mockReturnValue(new Promise(() => {}));
      render(<PublicProfileScreen />);
      expect(mockGet).toHaveBeenCalledWith('/profile/user-456');
    });
  });

  describe('Public fields display', () => {
    it('displays display name', async () => {
      mockGet.mockResolvedValue({ data: cleanerProfile });
      const { findByTestId } = render(<PublicProfileScreen />);
      const nameEl = await findByTestId('public-profile-name');
      expect(nameEl.props.children).toBe('Maria Garcia');
    });

    it('displays profile photo with signed URL', async () => {
      mockGet.mockResolvedValue({ data: cleanerProfile });
      const { findByTestId } = render(<PublicProfileScreen />);
      await findByTestId('public-profile-photo-image');
      expect(mockUseSignedUrl).toHaveBeenCalledWith(cleanerProfile.photoUrl);
    });

    it('displays bio section', async () => {
      mockGet.mockResolvedValue({ data: cleanerProfile });
      const { findByTestId, getByText } = render(<PublicProfileScreen />);
      await findByTestId('public-profile-bio');
      expect(getByText('Professional cleaner with 5 years of experience.')).toBeTruthy();
    });

    it('displays specialties as chips', async () => {
      mockGet.mockResolvedValue({ data: cleanerProfile });
      const { findByTestId, getByText } = render(<PublicProfileScreen />);
      await findByTestId('public-profile-specialties');
      expect(getByText('deep_cleaning')).toBeTruthy();
      expect(getByText('eco_friendly')).toBeTruthy();
      expect(getByText('window_cleaning')).toBeTruthy();
    });

    it('displays work zone label', async () => {
      mockGet.mockResolvedValue({ data: cleanerProfile });
      const { findByTestId } = render(<PublicProfileScreen />);
      const workZone = await findByTestId('public-profile-work-zone');
      expect(workZone).toBeTruthy();
    });

    it('displays average rating', async () => {
      mockGet.mockResolvedValue({ data: cleanerProfile });
      const { findByTestId } = render(<PublicProfileScreen />);
      const rating = await findByTestId('public-profile-rating');
      expect(rating).toBeTruthy();
    });

    it('displays completed services count', async () => {
      mockGet.mockResolvedValue({ data: cleanerProfile });
      const { findByTestId } = render(<PublicProfileScreen />);
      const services = await findByTestId('public-profile-completed-services');
      expect(services).toBeTruthy();
    });

    it('displays member since date', async () => {
      mockGet.mockResolvedValue({ data: cleanerProfile });
      const { findByTestId } = render(<PublicProfileScreen />);
      const memberSince = await findByTestId('public-profile-member-since');
      expect(memberSince).toBeTruthy();
    });
  });

  describe('Private fields NOT displayed', () => {
    it('does not display email anywhere', async () => {
      const profileWithEmail = { ...cleanerProfile, email: 'maria@test.com' };
      mockGet.mockResolvedValue({ data: profileWithEmail });
      const { findByTestId, queryByText } = render(<PublicProfileScreen />);
      await findByTestId('public-profile-screen');
      expect(queryByText('maria@test.com')).toBeNull();
    });

    it('does not display phone number anywhere', async () => {
      const profileWithPhone = { ...cleanerProfile, phoneNumber: '+573001234567' };
      mockGet.mockResolvedValue({ data: profileWithPhone });
      const { findByTestId, queryByText } = render(<PublicProfileScreen />);
      await findByTestId('public-profile-screen');
      expect(queryByText('+573001234567')).toBeNull();
    });

    it('does not display settings-related data', async () => {
      mockGet.mockResolvedValue({ data: cleanerProfile });
      const { findByTestId, queryByTestId } = render(<PublicProfileScreen />);
      await findByTestId('public-profile-screen');
      expect(queryByTestId('public-profile-settings')).toBeNull();
    });
  });

  describe('Signed URL expiry handling', () => {
    it('shows placeholder when signed URL is expired (null)', async () => {
      mockUseSignedUrl.mockReturnValue(null);
      mockGet.mockResolvedValue({ data: cleanerProfile });
      const { findByTestId, queryByTestId } = render(<PublicProfileScreen />);
      await findByTestId('public-profile-photo');
      expect(queryByTestId('public-profile-photo-image')).toBeNull();
    });

    it('shows photo when signed URL is valid', async () => {
      mockUseSignedUrl.mockImplementation((url: string | null) => url);
      mockGet.mockResolvedValue({ data: cleanerProfile });
      const { findByTestId } = render(<PublicProfileScreen />);
      const image = await findByTestId('public-profile-photo-image');
      expect(image).toBeTruthy();
    });
  });

  describe('KYC badge', () => {
    it('shows KYC badge when cleaner is verified', async () => {
      mockGet.mockResolvedValue({ data: cleanerProfile });
      const { findByTestId } = render(<PublicProfileScreen />);
      const badge = await findByTestId('public-profile-kyc-badge');
      expect(badge).toBeTruthy();
    });

    it('does not show KYC badge when not verified', async () => {
      const unverified = { ...cleanerProfile, kycBadge: false };
      mockGet.mockResolvedValue({ data: unverified });
      const { findByTestId, queryByTestId } = render(<PublicProfileScreen />);
      await findByTestId('public-profile-screen');
      expect(queryByTestId('public-profile-kyc-badge')).toBeNull();
    });
  });

  describe('Portfolio gallery', () => {
    it('shows portfolio gallery for cleaner profiles with photos', async () => {
      mockGet.mockResolvedValue({ data: cleanerProfile });
      const { findByTestId } = render(<PublicProfileScreen />);
      const portfolio = await findByTestId('public-profile-portfolio');
      expect(portfolio).toBeTruthy();
    });

    it('renders portfolio items', async () => {
      mockGet.mockResolvedValue({ data: cleanerProfile });
      const { findByTestId } = render(<PublicProfileScreen />);
      const item1 = await findByTestId('portfolio-item-p1');
      const item2 = await findByTestId('portfolio-item-p2');
      expect(item1).toBeTruthy();
      expect(item2).toBeTruthy();
    });

    it('does not show portfolio section when no photos', async () => {
      const noPortfolio = { ...cleanerProfile, portfolioPhotos: [] };
      mockGet.mockResolvedValue({ data: noPortfolio });
      const { findByTestId, queryByTestId } = render(<PublicProfileScreen />);
      await findByTestId('public-profile-screen');
      expect(queryByTestId('public-profile-portfolio')).toBeNull();
    });
  });

  describe('Host profile', () => {
    it('shows business name for host profiles', async () => {
      mockGet.mockResolvedValue({ data: hostProfile });
      const { findByTestId } = render(<PublicProfileScreen />);
      const businessName = await findByTestId('public-profile-business-name');
      expect(businessName.props.children).toBe('Smith Properties LLC');
    });

    it('shows placeholder initial when photo is null', async () => {
      mockUseSignedUrl.mockReturnValue(null);
      mockGet.mockResolvedValue({ data: hostProfile });
      const { findByTestId, queryByTestId } = render(<PublicProfileScreen />);
      await findByTestId('public-profile-photo');
      expect(queryByTestId('public-profile-photo-image')).toBeNull();
    });
  });
});
