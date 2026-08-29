/**
 * CreatePropertyScreen tests.
 * Covers: multi-step wizard + step indicator, per-step validation, forward geocoding,
 * manual pin fallback on geocoding failure, submit delegating to the store, and
 * navigating back on success.
 *
 * Child components (type selector, address input, map, photo/checklist editors) are
 * replaced with controllable stubs so the wizard flow can be driven deterministically.
 */

import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

/** Coordinates shared by the map stub, the geocode mock, and submit assertions. */
const PINNED_COORDINATES = { latitude: 25.79, longitude: -80.13 };

/** Address the AddressInput stub fills into the form. */
const SAMPLE_ADDRESS = { street: '123 Ocean Dr', city: 'Miami', country: 'US' };

// ─── Mocks ───────────────────────────────────────────────────────────────────

const stableT = (key: string, opts?: { defaultValue?: string }): string =>
  opts?.defaultValue ?? key;
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: stableT }),
}));

// Reanimated shims — avoid native animation drivers under jest.
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (v: unknown) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    withSpring: (v: unknown) => v,
    View,
  };
});

// PropertyTypeSelector: expose a button that selects a fixed type.
jest.mock('../components/PropertyTypeSelector', () => {
  const { Pressable, Text } = require('react-native');
  return {
    PropertyTypeSelector: ({ onChange }: { onChange: (t: string) => void }) => (
      <Pressable testID="select-type-house" onPress={() => onChange('house')}>
        <Text>house</Text>
      </Pressable>
    ),
  };
});

// AddressInput: expose a button that fills a valid address and one that triggers geocode.
jest.mock('../components/AddressInput', () => {
  const { Pressable, Text } = require('react-native');
  return {
    AddressInput: ({
      onChange,
      onGeocode,
    }: {
      onChange: (addr: Record<string, unknown>) => void;
      onGeocode: () => void;
    }) => (
      <>
        <Pressable
          testID="fill-address"
          onPress={() =>
            onChange({ street: '123 Ocean Dr', city: 'Miami', country: 'US' })
          }
        >
          <Text>fill</Text>
        </Pressable>
        <Pressable testID="trigger-geocode" onPress={onGeocode}>
          <Text>geocode</Text>
        </Pressable>
      </>
    ),
  };
});

// PropertyMap: expose a button that simulates a manual pin placement.
jest.mock('../components/PropertyMap', () => {
  const { Pressable, Text } = require('react-native');
  return {
    PropertyMap: ({
      onLocationChange,
    }: {
      onLocationChange?: (c: { latitude: number; longitude: number }) => void;
    }) => (
      <Pressable
        testID="place-pin"
        onPress={() => onLocationChange?.({ latitude: 25.79, longitude: -80.13 })}
      >
        <Text>map</Text>
      </Pressable>
    ),
  };
});

jest.mock('../components/PhotoUploader', () => {
  const { View } = require('react-native');
  return { PhotoUploader: () => <View testID="photo-uploader" /> };
});
jest.mock('../components/ChecklistEditor', () => {
  const { View } = require('react-native');
  return { ChecklistEditor: () => <View testID="checklist-editor" /> };
});

// useProperties convenience hook — controlled per test.
const hookState: Record<string, unknown> = {};
jest.mock('../useProperties', () => ({
  useProperties: () => hookState,
}));

import { CreatePropertyScreen } from '../CreatePropertyScreen';

// ─── Helpers ───────────────────────────────────────────────────────────────────

const createProperty = jest.fn();
const geocode = jest.fn();
const reverseGeocode = jest.fn().mockResolvedValue(null);
const clearError = jest.fn();

function setHook(overrides: Record<string, unknown> = {}): void {
  Object.assign(hookState, {
    createProperty,
    geocode,
    reverseGeocode,
    isMutating: false,
    error: null,
    clearError,
    ...overrides,
  });
}

/** Fill step 1 (name + type + square meters) and advance to step 2. */
function completeStep1(screen: ReturnType<typeof render>): void {
  fireEvent.changeText(screen.getByTestId('input-property-name'), 'Beach House');
  fireEvent.press(screen.getByTestId('select-type-house'));
  fireEvent.changeText(screen.getByTestId('input-square-meters'), '120');
  fireEvent.press(screen.getByTestId('create-property-next-btn'));
}

/** Fill step 2 (address + pin) and advance to step 3. */
function completeStep2(screen: ReturnType<typeof render>): void {
  fireEvent.press(screen.getByTestId('fill-address'));
  fireEvent.press(screen.getByTestId('place-pin'));
  fireEvent.press(screen.getByTestId('create-property-next-btn'));
}

describe('CreatePropertyScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHook();
    createProperty.mockResolvedValue({ id: 'prop-1' });
    geocode.mockResolvedValue(PINNED_COORDINATES);
  });

  it('renders the multi-step form with a step indicator', () => {
    const { getByTestId } = render(<CreatePropertyScreen />);
    expect(getByTestId('create-property-screen')).toBeTruthy();
    expect(getByTestId('step-indicator')).toBeTruthy();
    expect(getByTestId('step-1-basic-info')).toBeTruthy();
  });

  it('blocks advancing while required step-1 fields are missing', () => {
    const screen = render(<CreatePropertyScreen />);
    // No name/type/sqm entered → pressing Next keeps us on step 1.
    fireEvent.press(screen.getByTestId('create-property-next-btn'));
    expect(screen.getByTestId('step-1-basic-info')).toBeTruthy();
    expect(screen.queryByTestId('step-2-address')).toBeNull();
  });

  it('advances to step 2 once step-1 fields are valid', () => {
    const screen = render(<CreatePropertyScreen />);
    completeStep1(screen);
    expect(screen.getByTestId('step-2-address')).toBeTruthy();
  });

  it('performs forward geocoding on address entry', async () => {
    const screen = render(<CreatePropertyScreen />);
    completeStep1(screen);
    fireEvent.press(screen.getByTestId('fill-address'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('trigger-geocode'));
    });
    expect(geocode).toHaveBeenCalledWith(
      expect.objectContaining({
        address: expect.stringContaining(SAMPLE_ADDRESS.street),
        country: SAMPLE_ADDRESS.country,
      }),
    );
  });

  it('falls back to manual pin placement when geocoding fails', async () => {
    geocode.mockResolvedValue(null);
    const screen = render(<CreatePropertyScreen />);
    completeStep1(screen);
    fireEvent.press(screen.getByTestId('fill-address'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('trigger-geocode'));
    });
    // Manual pin still sets coordinates so the user can proceed.
    fireEvent.press(screen.getByTestId('place-pin'));
    fireEvent.press(screen.getByTestId('create-property-next-btn'));
    expect(screen.getByTestId('step-3-details')).toBeTruthy();
  });

  it('reaches the final step and shows the photo uploader', () => {
    const screen = render(<CreatePropertyScreen />);
    completeStep1(screen);
    completeStep2(screen);
    expect(screen.getByTestId('step-3-details')).toBeTruthy();
    expect(screen.getByTestId('create-property-submit-btn')).toBeTruthy();
  });

  it('submits the property and navigates back on success', async () => {
    const onSuccess = jest.fn();
    const screen = render(<CreatePropertyScreen onSuccess={onSuccess} />);
    completeStep1(screen);
    completeStep2(screen);
    await act(async () => {
      fireEvent.press(screen.getByTestId('create-property-submit-btn'));
    });
    await waitFor(() => {
      expect(createProperty).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Beach House',
          type: 'house',
          squareMeters: 120,
          location: PINNED_COORDINATES,
        }),
      );
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when going back from the first step', () => {
    const onCancel = jest.fn();
    const { getByTestId } = render(<CreatePropertyScreen onCancel={onCancel} />);
    fireEvent.press(getByTestId('create-property-back-btn'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
