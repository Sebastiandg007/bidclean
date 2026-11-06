/**
 * Unit/render tests for the dispute screens + components + i18n parity (Spec 21).
 *
 * Covers: Host status badge + countdown + reason picker while OPEN; the Cleaner auto-release-paused
 * indicator + note field; the outcome summary once RESOLVED; en/es dispute i18n parity. react-i18next
 * returns keys (stable assertions); the api is mocked (render only, zero external calls).
 */

const stableT = (key: string): string => key;
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: stableT }) }));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchImageLibraryAsync: jest.fn().mockResolvedValue({ canceled: true, assets: null }),
}));

jest.mock('../dispute.api', () => ({
  getDisputeRequest: jest.fn().mockResolvedValue(undefined),
  requestUploadRequest: jest.fn(),
  putEvidenceBytes: jest.fn(),
  finalizeUploadRequest: jest.fn(),
  addStructuredEvidenceRequest: jest.fn(),
  getEvidenceUrlRequest: jest.fn(),
}));

import { render, screen } from '@testing-library/react-native';

import { DisputeHostScreen } from '../DisputeHostScreen';
import { DisputeCleanerScreen } from '../DisputeCleanerScreen';
import { useDisputeStore } from '../dispute.store';
import type { Dispute } from '../dispute.types';
import enDispute from '../../../i18n/locales/en/dispute.json';
import esDispute from '../../../i18n/locales/es/dispute.json';

function dispute(overrides: Partial<Dispute> = {}): Dispute {
  return {
    id: 'dispute-1',
    serviceCompletionId: 'comp-1',
    offerId: 'offer-1',
    state: 'OPEN',
    phase: 'PRE_RELEASE',
    initiatorRole: 'HOST',
    reasonCode: 'QUALITY_INCOMPLETE',
    resolution: null,
    resolutionRefundCents: null,
    evidenceDeadline: new Date(Date.now() + 172_800_000).toISOString(),
    resolutionDeadline: new Date(Date.now() + 604_800_000).toISOString(),
    resolvedAt: null,
    evidence: [],
    ...overrides,
  };
}

const hostRoute = { params: { disputeId: 'dispute-1', reasonCodes: ['QUALITY_INCOMPLETE'] } };
const cleanerRoute = { params: { disputeId: 'dispute-1' } };
const navigation = { goBack: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  useDisputeStore.getState().reset();
});

describe('DisputeHostScreen', () => {
  it('shows the status badge, countdown and reason picker while OPEN', () => {
    useDisputeStore.setState({ dispute: dispute() });
    render(<DisputeHostScreen route={hostRoute} navigation={navigation} />);
    expect(screen.getByTestId('dispute-status-badge')).toBeTruthy();
    expect(screen.getByTestId('dispute-host-countdown')).toBeTruthy();
    expect(screen.getByTestId('dispute-reason-picker')).toBeTruthy();
  });

  it('shows the outcome summary once RESOLVED', () => {
    useDisputeStore.setState({
      dispute: dispute({ state: 'RESOLVED', resolution: 'FAVOR_HOST', resolutionRefundCents: 500 }),
    });
    render(<DisputeHostScreen route={hostRoute} navigation={navigation} />);
    expect(screen.getByTestId('dispute-outcome-summary')).toBeTruthy();
  });
});

describe('DisputeCleanerScreen', () => {
  it('shows the auto-release-paused indicator + note field while OPEN', () => {
    useDisputeStore.setState({ dispute: dispute() });
    render(<DisputeCleanerScreen route={cleanerRoute} navigation={navigation} />);
    expect(screen.getByTestId('dispute-cleaner-paused')).toBeTruthy();
    expect(screen.getByTestId('dispute-cleaner-note')).toBeTruthy();
  });

  it('shows the outcome summary once EXPIRED with a fallback resolution', () => {
    useDisputeStore.setState({
      dispute: dispute({ state: 'EXPIRED', resolution: 'FAVOR_CLEANER' }),
    });
    render(<DisputeCleanerScreen route={cleanerRoute} navigation={navigation} />);
    expect(screen.getByTestId('dispute-outcome-summary')).toBeTruthy();
  });
});

describe('dispute i18n parity', () => {
  it('has identical key structures for en and es', () => {
    expect(collectKeys(enDispute)).toEqual(collectKeys(esDispute));
  });
});

/** Collect the sorted dotted key paths of a nested object for parity comparison. */
function collectKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix === '' ? key : `${prefix}.${key}`;
    if (value !== null && typeof value === 'object') {
      keys.push(...collectKeys(value as Record<string, unknown>, full));
    } else {
      keys.push(full);
    }
  }
  return keys.sort();
}
