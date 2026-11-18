/**
 * Unit tests for usePositionReporter (Cleaner, Spec 17).
 *
 * expo-location is mocked. Verifies: reports only while EN_ROUTE + granted; permission-denied
 * degrades gracefully (never crashes, exposes a status); never publishes to the channel (there is
 * no publish path — the hook only calls the store's reportPosition, which POSTs to the backend).
 */

const mockWatchPositionAsync = jest.fn();
const mockRequestForeground = jest.fn();
const mockRemove = jest.fn();

jest.mock('expo-location', () => ({
  Accuracy: { High: 4, Balanced: 3 },
  watchPositionAsync: (...args: unknown[]) => mockWatchPositionAsync(...args),
  requestForegroundPermissionsAsync: (...args: unknown[]) => mockRequestForeground(...args),
}));

const mockReportPosition = jest.fn();
jest.mock('../tracking.store', () => ({
  useTrackingStore: (selector: (s: unknown) => unknown) =>
    selector({ reportPosition: mockReportPosition }),
}));

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { usePositionReporter } from '../usePositionReporter';

beforeEach(() => {
  jest.clearAllMocks();
  mockWatchPositionAsync.mockResolvedValue({ remove: mockRemove });
});

describe('usePositionReporter', () => {
  it('does NOT watch while not EN_ROUTE even if permission is granted', async () => {
    mockRequestForeground.mockResolvedValue({ status: 'granted' });
    const { result } = renderHook(() => usePositionReporter({ sessionId: 's1', state: 'MATCHED' }));
    await act(async () => {
      await result.current.requestPermission();
    });
    expect(mockWatchPositionAsync).not.toHaveBeenCalled();
  });

  it('watches + reports once EN_ROUTE and permission granted', async () => {
    mockRequestForeground.mockResolvedValue({ status: 'granted' });
    const { result } = renderHook(() => usePositionReporter({ sessionId: 's1', state: 'EN_ROUTE' }));
    await act(async () => {
      await result.current.requestPermission();
    });
    await waitFor(() => expect(mockWatchPositionAsync).toHaveBeenCalled());

    // Simulate a position callback → the store's reportPosition is invoked (POST to backend).
    const callback = mockWatchPositionAsync.mock.calls[0]?.[1] as (loc: unknown) => void;
    act(() => {
      callback({
        coords: { latitude: 4.6, longitude: -74.08, accuracy: 8, heading: 90 },
        timestamp: Date.now(),
      });
    });
    expect(mockReportPosition).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ lat: 4.6, lng: -74.08, accuracy: 8 }),
    );
  });

  it('degrades gracefully when permission is denied (status exposed, no crash)', async () => {
    mockRequestForeground.mockResolvedValue({ status: 'denied' });
    const { result } = renderHook(() => usePositionReporter({ sessionId: 's1', state: 'EN_ROUTE' }));
    await act(async () => {
      await result.current.requestPermission();
    });
    expect(result.current.permissionStatus).toBe('denied');
    expect(mockWatchPositionAsync).not.toHaveBeenCalled();
  });

  it('throttles rapid samples to the client cadence', async () => {
    mockRequestForeground.mockResolvedValue({ status: 'granted' });
    const { result } = renderHook(() => usePositionReporter({ sessionId: 's1', state: 'EN_ROUTE' }));
    await act(async () => {
      await result.current.requestPermission();
    });
    await waitFor(() => expect(mockWatchPositionAsync).toHaveBeenCalled());
    const callback = mockWatchPositionAsync.mock.calls[0]?.[1] as (loc: unknown) => void;
    const loc = {
      coords: { latitude: 4.6, longitude: -74.08, accuracy: 8, heading: null },
      timestamp: Date.now(),
    };
    act(() => {
      callback(loc);
      callback(loc); // immediate second sample → throttled out
    });
    expect(mockReportPosition).toHaveBeenCalledTimes(1);
  });
});
