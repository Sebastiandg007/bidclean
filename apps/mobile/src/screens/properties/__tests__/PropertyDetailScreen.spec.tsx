/**
 * PropertyDetailScreen tests.
 * Covers: photo gallery, map, info grid (dimensions/rooms), checklist,
 * special requirements chips, offer-readiness indicator, and the Edit action.
 */

import { render, fireEvent } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { Property } from '../properties.types';

// Alert.alert may be undefined under the jest-expo RN mock. Assign a stable mock
// directly (rather than spyOn/restore, which could leave it undefined for other
// suites sharing the RN module).
Alert.alert = jest.fn();

// ─── Mocks ───────────────────────────────────────────────────────────────────

const stableT = (key: string, opts?: { defaultValue?: string }): string =>
  opts?.defaultValue ?? key;
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: stableT }),
}));

// PropertyMap wraps Mapbox — replace it with a testable stub.
jest.mock('../components/PropertyMap', () => {
  const { View } = require('react-native');
  return {
    PropertyMap: () => <View testID="property-detail-map" />,
  };
});

// useProperties convenience hook — return controlled state per test.
const hookState: Record<string, unknown> = {};
jest.mock('../useProperties', () => ({
  useProperties: () => hookState,
}));

import { PropertyDetailScreen } from '../PropertyDetailScreen';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const fetchDetail = jest.fn().mockResolvedValue(undefined);
const clearError = jest.fn();

const sampleProperty: Property = {
  id: 'prop-1',
  name: 'Beach House',
  type: 'house',
  description: 'A sunny place by the sea',
  address: {
    street: '123 Ocean Dr',
    city: 'Miami',
    state: 'FL',
    country: 'US',
    postalCode: '33139',
  },
  location: { latitude: 25.79, longitude: -80.13 },
  locationSource: 'GEOCODED',
  formattedAddress: '123 Ocean Dr, Miami, FL',
  squareMeters: 120,
  floorNumber: 2,
  bedrooms: 3,
  bathrooms: 2,
  hasParking: true,
  hasElevator: false,
  specialRequirements: ['pets', 'eco_friendly'],
  checklistItems: ['Clean windows', 'Vacuum living room'],
  accessInstructions: 'Key under the mat',
  photos: [
    { id: 'ph-1', url: 'https://cdn/p1.jpg', displayOrder: 0, mimeType: 'image/jpeg', fileSizeBytes: 1000 },
    { id: 'ph-2', url: 'https://cdn/p2.jpg', displayOrder: 1, mimeType: 'image/jpeg', fileSizeBytes: 2000 },
  ],
  isOfferReady: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

function setHook(overrides: Record<string, unknown> = {}): void {
  Object.assign(hookState, {
    selectedProperty: sampleProperty,
    isDetailLoading: false,
    error: null,
    fetchDetail,
    clearError,
    ...overrides,
  });
}

describe('PropertyDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-assign per test: another suite in the same process can reset the shared
    // RN module and leave Alert.alert undefined.
    Alert.alert = jest.fn();
    setHook();
  });

  it('fetches the property detail on mount', () => {
    render(<PropertyDetailScreen propertyId="prop-1" />);
    expect(fetchDetail).toHaveBeenCalledWith('prop-1');
  });

  it('renders the property photo gallery', () => {
    const { getByTestId } = render(<PropertyDetailScreen propertyId="prop-1" />);
    expect(getByTestId('property-detail-gallery')).toBeTruthy();
    expect(getByTestId('property-detail-photo-0')).toBeTruthy();
    expect(getByTestId('property-detail-photo-1')).toBeTruthy();
  });

  it('renders the property map', () => {
    const { getByTestId } = render(<PropertyDetailScreen propertyId="prop-1" />);
    expect(getByTestId('property-detail-map')).toBeTruthy();
  });

  it('displays property dimensions and room counts', () => {
    const { getByTestId } = render(<PropertyDetailScreen propertyId="prop-1" />);
    expect(getByTestId('property-detail-info-grid')).toBeTruthy();
    expect(getByTestId('info-card-sqm')).toBeTruthy();
    expect(getByTestId('info-card-bedrooms')).toBeTruthy();
    expect(getByTestId('info-card-bathrooms')).toBeTruthy();
  });

  it('displays checklist items', () => {
    const { getByTestId } = render(<PropertyDetailScreen propertyId="prop-1" />);
    expect(getByTestId('property-detail-checklist')).toBeTruthy();
  });

  it('displays special requirements as chips', () => {
    const { getByTestId } = render(<PropertyDetailScreen propertyId="prop-1" />);
    expect(getByTestId('property-detail-requirements')).toBeTruthy();
    expect(getByTestId('requirement-chip-pets')).toBeTruthy();
    expect(getByTestId('requirement-chip-eco_friendly')).toBeTruthy();
  });

  it('displays the offer-readiness indicator', () => {
    const { getByTestId } = render(<PropertyDetailScreen propertyId="prop-1" />);
    expect(getByTestId('property-detail-offer-readiness')).toBeTruthy();
  });

  it('triggers the Edit action on Edit button press', () => {
    const { getByTestId } = render(<PropertyDetailScreen propertyId="prop-1" />);
    fireEvent.press(getByTestId('property-detail-edit-button'));
    expect(Alert.alert).toHaveBeenCalled();
  });

  it('shows the loading state while the detail is loading', () => {
    setHook({ isDetailLoading: true, selectedProperty: null });
    const { getByTestId } = render(<PropertyDetailScreen propertyId="prop-1" />);
    expect(getByTestId('property-detail-loading')).toBeTruthy();
  });

  it('shows the error state and retries on press', () => {
    setHook({ error: 'properties.error.fetch_failed', selectedProperty: null });
    const { getByTestId } = render(<PropertyDetailScreen propertyId="prop-1" />);
    fireEvent.press(getByTestId('property-detail-retry'));
    expect(clearError).toHaveBeenCalled();
    expect(fetchDetail).toHaveBeenCalledWith('prop-1');
  });
});
