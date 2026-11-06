/**
 * Unit tests for the tracking screens + i18n parity (Spec 17).
 *
 * Covers: EnRouteScreen "Start" affordance enabled only when ARRIVED + permission-denied explainer;
 * TrackingScreen renders live state, the "arrived" indication, and "location unavailable"; en/es
 * tracking i18n keys are in parity. react-i18next returns keys (stable assertions); Mapbox + the
 * hooks + the store api are mocked (render only, zero external calls).
 */

const stableT = (key: string): string => key;
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: stableT }) }));

jest.mock('@rnmapbox/maps', () => ({
  __esModule: true,
  default: {
    MapView: ({ children }: { children?: unknown }) => children ?? null,
    Camera: () => null,
    PointAnnotation: () => null,
  },
}));

const mockRequestPermission = jest.fn();
let mockPermissionStatus: 'unknown' | 'granted' | 'denied' = 'granted';
jest.mock('../usePositionReporter', () => ({
  usePositionReporter: () => ({
    permissionStatus: mockPermissionStatus,
    requestPermission: mockRequestPermission,
  }),
}));

jest.mock('../useTrackingChannel', () => ({
  useTrackingChannel: () => ({ isConnected: true, disconnect: jest.fn() }),
}));

import { render, screen } from '@testing-library/react-native';

import { EnRouteScreen } from '../EnRouteScreen';
import { TrackingScreen } from '../TrackingScreen';
import { useTrackingStore } from '../tracking.store';
import type { ServiceSession } from '../tracking.types';
import enTracking from '../../../i18n/locales/en/tracking.json';
import esTracking from '../../../i18n/locales/es/tracking.json';

function session(overrides: Partial<ServiceSession> = {}): ServiceSession {
  return {
    id: 'sess-1',
    offerId: 'offer-1',
    hostId: 'host-1',
    cleanerId: 'cleaner-1',
    propertyId: 'prop-1',
    state: 'EN_ROUTE',
    endedReason: null,
    geofenceRadiusM: 50,
    propertyLocation: { lat: 4.6, lng: -74.08 },
    enRouteAt: null,
    arrivedAt: null,
    startedAt: null,
    arrivalDistanceM: null,
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

const route = { params: { sessionId: 'sess-1' } };
const navigation = { goBack: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  mockPermissionStatus = 'granted';
  useTrackingStore.getState().reset();
});

describe('EnRouteScreen (Cleaner)', () => {
  it('disables "Start work" until the session is ARRIVED', () => {
    useTrackingStore.setState({ session: session({ state: 'EN_ROUTE' }) });
    render(<EnRouteScreen route={route} navigation={navigation} />);
    expect(screen.getByTestId('enroute-start-work').props.accessibilityState?.disabled).toBe(true);
  });

  it('enables "Start work" when ARRIVED', () => {
    useTrackingStore.setState({ session: session({ state: 'ARRIVED' }) });
    render(<EnRouteScreen route={route} navigation={navigation} />);
    expect(screen.getByTestId('enroute-start-work').props.accessibilityState?.disabled).toBe(false);
  });

  it('shows the permission explainer when denied (graceful degrade)', () => {
    mockPermissionStatus = 'denied';
    useTrackingStore.setState({ session: session({ state: 'EN_ROUTE' }) });
    render(<EnRouteScreen route={route} navigation={navigation} />);
    expect(screen.getByTestId('enroute-permission-denied')).toBeTruthy();
  });
});

describe('TrackingScreen (Host)', () => {
  it('renders the current state label', () => {
    useTrackingStore.setState({ session: session({ state: 'EN_ROUTE' }) });
    render(<TrackingScreen route={route} navigation={navigation} />);
    expect(screen.getByTestId('tracking-state').props.children).toBe('tracking.state.onTheWay');
  });

  it('shows the "cleaner arrived" indication when ARRIVED', () => {
    useTrackingStore.setState({ session: session({ state: 'ARRIVED' }) });
    render(<TrackingScreen route={route} navigation={navigation} />);
    expect(screen.getByTestId('tracking-arrived')).toBeTruthy();
  });

  it('shows "location unavailable" when no live position and not arrived', () => {
    useTrackingStore.setState({ session: session({ state: 'EN_ROUTE' }), livePosition: null });
    render(<TrackingScreen route={route} navigation={navigation} />);
    expect(screen.getByTestId('tracking-location-unavailable')).toBeTruthy();
  });
});

describe('tracking i18n parity', () => {
  function leafKeys(obj: unknown, prefix = ''): string[] {
    if (typeof obj !== 'object' || obj === null) {
      return [prefix];
    }
    return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
      leafKeys(value, prefix ? `${prefix}.${key}` : key),
    );
  }

  it('en and es tracking blocks have identical key sets', () => {
    const en = (enTracking as { tracking: unknown }).tracking;
    const es = (esTracking as { tracking: unknown }).tracking;
    expect(leafKeys(en).sort()).toEqual(leafKeys(es).sort());
  });
});
