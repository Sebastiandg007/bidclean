/**
 * Unit tests for the verification screens + i18n parity (Spec 18).
 *
 * Covers: the Host indicator renders per state (verified / needs-review / unavailable) and NEVER
 * shows footage or a score; needs-review shows a dispute path (no auto-cancel); the Cleaner screen
 * shows the permission-denied explainer gracefully; en/es verification i18n keys are in parity.
 * react-i18next returns keys (stable assertions); the recorder + store are mocked (render only).
 */

const stableT = (key: string): string => key;
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: stableT }) }));

jest.mock('expo-camera', () => ({ CameraView: () => null }));

let mockRecorderStatus: 'unknown' | 'granted' | 'denied' = 'granted';
jest.mock('../useArrivalRecorder', () => ({
  useArrivalRecorder: () => ({
    permissionStatus: mockRecorderStatus,
    isRecording: false,
    elapsedMs: 0,
    maxDurationMs: 15000,
    requestPermission: jest.fn(),
    startRecording: jest.fn().mockResolvedValue(null),
    stopRecording: jest.fn(),
  }),
}));

import { render, screen } from '@testing-library/react-native';

import { ArrivalVerificationIndicator } from '../ArrivalVerificationIndicator';
import { ArrivalVerificationScreen } from '../ArrivalVerificationScreen';
import { useVerificationStore } from '../verification.store';
import type { VerificationState } from '../verification.types';
import enVerification from '../../../i18n/locales/en/verification.json';
import esVerification from '../../../i18n/locales/es/verification.json';

function seed(state: VerificationState): void {
  useVerificationStore.setState({
    verification: {
      id: 'ver-1',
      serviceSessionId: 'sess-1',
      state,
      classification: state === 'MATCH' ? 'verified' : state === 'NO_MATCH' ? 'needs-review' : 'unavailable',
      createdAt: new Date(0).toISOString(),
      uploadedAt: null,
      processedAt: null,
    },
  });
}

const hostRoute = { params: { verificationId: 'ver-1' } };
const navigation = { goBack: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  mockRecorderStatus = 'granted';
  useVerificationStore.getState().reset();
});

describe('ArrivalVerificationIndicator (Host)', () => {
  it('renders the verified badge for a MATCH', () => {
    seed('MATCH');
    render(<ArrivalVerificationIndicator route={hostRoute} navigation={navigation} />);
    expect(screen.getByTestId('verification-badge-verified')).toBeTruthy();
  });

  it('renders needs-review with a dispute path (no accusation/auto-cancel) for NO_MATCH', () => {
    seed('NO_MATCH');
    render(<ArrivalVerificationIndicator route={hostRoute} navigation={navigation} />);
    expect(screen.getByTestId('verification-badge-needs-review')).toBeTruthy();
    expect(screen.getByTestId('verification-dispute-path')).toBeTruthy();
  });

  it('renders unavailable for FAILED and never exposes footage/score', () => {
    seed('FAILED');
    render(<ArrivalVerificationIndicator route={hostRoute} navigation={navigation} />);
    expect(screen.getByTestId('verification-badge-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('verification-video')).toBeNull();
  });
});

describe('ArrivalVerificationScreen (Cleaner)', () => {
  it('shows the permission explainer when denied (graceful degrade, never blocks)', () => {
    mockRecorderStatus = 'denied';
    render(<ArrivalVerificationScreen route={hostRoute} navigation={navigation} />);
    expect(screen.getByTestId('verification-permission-denied')).toBeTruthy();
  });

  it('renders the camera + record button when permission is granted', () => {
    render(<ArrivalVerificationScreen route={hostRoute} navigation={navigation} />);
    expect(screen.getByTestId('verification-camera')).toBeTruthy();
    expect(screen.getByTestId('verification-record-button')).toBeTruthy();
  });
});

describe('verification i18n parity', () => {
  function leafKeys(obj: unknown, prefix = ''): string[] {
    if (typeof obj !== 'object' || obj === null) {
      return [prefix];
    }
    return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
      leafKeys(value, prefix ? `${prefix}.${key}` : key),
    );
  }

  it('en and es verification blocks have identical key sets', () => {
    const en = (enVerification as { verification: unknown }).verification;
    const es = (esVerification as { verification: unknown }).verification;
    expect(leafKeys(en).sort()).toEqual(leafKeys(es).sort());
  });
});
