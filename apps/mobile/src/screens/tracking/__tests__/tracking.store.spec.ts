/**
 * Unit tests for tracking.store (Spec 17).
 *
 * Verify idempotent state-signal application (ignore regressions/older/illegal transitions),
 * `reconcile` via GET, ephemeral live-position newest-wins, and reset. The api layer is mocked to
 * avoid network.
 */

const mockGetSession = jest.fn();
const mockStartEnRoute = jest.fn();
const mockPostPosition = jest.fn();
const mockStart = jest.fn();
const mockCancel = jest.fn();

jest.mock('../tracking.api', () => ({
  getSessionRequest: (...args: unknown[]) => mockGetSession(...args),
  startEnRouteRequest: (...args: unknown[]) => mockStartEnRoute(...args),
  postPositionRequest: (...args: unknown[]) => mockPostPosition(...args),
  startRequest: (...args: unknown[]) => mockStart(...args),
  cancelRequest: (...args: unknown[]) => mockCancel(...args),
}));

import { useTrackingStore } from '../tracking.store';
import type { ServiceSession } from '../tracking.types';

function session(overrides: Partial<ServiceSession> = {}): ServiceSession {
  return {
    id: 'sess-1',
    offerId: 'offer-1',
    hostId: 'host-1',
    cleanerId: 'cleaner-1',
    propertyId: 'prop-1',
    state: 'MATCHED',
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

beforeEach(() => {
  jest.clearAllMocks();
  useTrackingStore.getState().reset();
});

describe('tracking.store — loadSession / reconcile', () => {
  it('loadSession stores the authoritative session', async () => {
    mockGetSession.mockResolvedValue(session({ state: 'EN_ROUTE' }));
    await useTrackingStore.getState().loadSession('sess-1');
    expect(useTrackingStore.getState().session?.state).toBe('EN_ROUTE');
  });

  it('reconcile keeps existing state on failure (best-effort)', async () => {
    useTrackingStore.setState({ session: session({ state: 'ARRIVED' }) });
    mockGetSession.mockRejectedValue(new Error('offline'));
    await useTrackingStore.getState().reconcile('sess-1');
    expect(useTrackingStore.getState().session?.state).toBe('ARRIVED');
  });

  it('loadSession surfaces an i18n error key on failure', async () => {
    mockGetSession.mockRejectedValue(new Error('boom'));
    await useTrackingStore.getState().loadSession('sess-1');
    expect(useTrackingStore.getState().error).toBe('tracking.loadError');
  });
});

describe('tracking.store — onStateSignal (idempotent, no regression)', () => {
  it('applies a forward transition', () => {
    useTrackingStore.setState({ session: session({ state: 'EN_ROUTE' }) });
    useTrackingStore.getState().onStateSignal({ type: 'state', state: 'ARRIVED' });
    expect(useTrackingStore.getState().session?.state).toBe('ARRIVED');
  });

  it('ignores a regression (ARRIVED → EN_ROUTE)', () => {
    useTrackingStore.setState({ session: session({ state: 'ARRIVED' }) });
    useTrackingStore.getState().onStateSignal({ type: 'state', state: 'EN_ROUTE' });
    expect(useTrackingStore.getState().session?.state).toBe('ARRIVED');
  });

  it('is idempotent for the same state', () => {
    useTrackingStore.setState({ session: session({ state: 'EN_ROUTE' }) });
    useTrackingStore.getState().onStateSignal({ type: 'state', state: 'EN_ROUTE' });
    expect(useTrackingStore.getState().session?.state).toBe('EN_ROUTE');
  });

  it('no-ops when there is no authoritative baseline yet', () => {
    useTrackingStore.getState().onStateSignal({ type: 'state', state: 'ARRIVED' });
    expect(useTrackingStore.getState().session).toBeNull();
  });

  it('applies a terminal signal and carries the endedReason', () => {
    useTrackingStore.setState({ session: session({ state: 'EN_ROUTE' }) });
    useTrackingStore
      .getState()
      .onStateSignal({ type: 'state', state: 'EXPIRED', endedReason: 'EXPIRED_NO_PROGRESS' });
    expect(useTrackingStore.getState().session?.state).toBe('EXPIRED');
    expect(useTrackingStore.getState().session?.endedReason).toBe('EXPIRED_NO_PROGRESS');
  });
});

describe('tracking.store — onLivePosition (ephemeral, newest wins)', () => {
  it('keeps only the latest live position frame', () => {
    const store = useTrackingStore.getState();
    store.onLivePosition({ type: 'position', lat: 1, lng: 2, accuracy: 5, at: 100 });
    store.onLivePosition({ type: 'position', lat: 3, lng: 4, accuracy: 6, at: 200 });
    const live = useTrackingStore.getState().livePosition;
    expect(live).toEqual({ lat: 3, lng: 4, accuracy: 6, heading: null, at: 200 });
  });
});

describe('tracking.store — actions delegate to the api', () => {
  it('startEnRoute stores the returned session', async () => {
    mockStartEnRoute.mockResolvedValue(session({ state: 'EN_ROUTE' }));
    await useTrackingStore.getState().startEnRoute('sess-1');
    expect(mockStartEnRoute).toHaveBeenCalledWith('sess-1');
    expect(useTrackingStore.getState().session?.state).toBe('EN_ROUTE');
  });

  it('reportPosition swallows errors (best-effort)', async () => {
    mockPostPosition.mockRejectedValue(new Error('dropped'));
    await expect(
      useTrackingStore
        .getState()
        .reportPosition('sess-1', { lat: 1, lng: 2, accuracy: 5, heading: null, at: 1 }),
    ).resolves.toBeUndefined();
  });

  it('reset clears the store', () => {
    useTrackingStore.setState({ session: session(), connectionStatus: 'connected' });
    useTrackingStore.getState().reset();
    expect(useTrackingStore.getState().session).toBeNull();
    expect(useTrackingStore.getState().connectionStatus).toBe('disconnected');
  });
});
