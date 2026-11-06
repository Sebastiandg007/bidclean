/**
 * Unit tests for the completion screens + i18n parity (Spec 20).
 *
 * Covers: Host confirm/dispute actions + countdown while AWAITING; the paused indicator on DISPUTED;
 * the rating prompt once released; the Cleaner release-status badge from `releaseStatus`; en/es
 * completion i18n parity. react-i18next returns keys (stable assertions); the store api is mocked
 * (render only, zero external calls).
 */

const stableT = (key: string): string => key;
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: stableT }) }));

jest.mock('../completion.api', () => ({
  getCompletionRequest: jest.fn().mockResolvedValue(undefined),
  confirmCompletionRequest: jest.fn(),
  disputeCompletionRequest: jest.fn(),
  postReleaseDisputeRequest: jest.fn(),
  submitRatingRequest: jest.fn(),
  getRatingsRequest: jest.fn(),
}));

import { render, screen } from '@testing-library/react-native';

import { CompletionHostScreen } from '../CompletionHostScreen';
import { CompletionCleanerScreen } from '../CompletionCleanerScreen';
import { useCompletionStore } from '../completion.store';
import type { ServiceCompletion } from '../completion.types';
import enCompletion from '../../../i18n/locales/en/completion.json';
import esCompletion from '../../../i18n/locales/es/completion.json';

function completion(overrides: Partial<ServiceCompletion> = {}): ServiceCompletion {
  return {
    id: 'comp-1',
    serviceSessionId: 'sess-1',
    offerId: 'offer-1',
    state: 'AWAITING_CONFIRMATION',
    autoReleaseDeadline: new Date(Date.now() + 86_400_000).toISOString(),
    confirmedAt: null,
    releasedTrigger: null,
    disputeId: null,
    postReleaseDisputeId: null,
    releaseStatus: 'NOT_TRIGGERED',
    ratingStatus: { hostRated: false, cleanerRated: false },
    ...overrides,
  };
}

const route = { params: { completionId: 'comp-1' } };
const navigation = { goBack: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  useCompletionStore.getState().reset();
});

describe('CompletionHostScreen', () => {
  it('shows confirm/dispute actions + countdown while AWAITING_CONFIRMATION', () => {
    useCompletionStore.setState({ completion: completion() });
    render(<CompletionHostScreen route={route} navigation={navigation} />);
    expect(screen.getByTestId('confirm-dispute-actions')).toBeTruthy();
    expect(screen.getByTestId('auto-release-countdown')).toBeTruthy();
  });

  it('shows the paused indicator when DISPUTED', () => {
    useCompletionStore.setState({ completion: completion({ state: 'DISPUTED', disputeId: 'd-1' }) });
    render(<CompletionHostScreen route={route} navigation={navigation} />);
    expect(screen.getByTestId('completion-host-paused')).toBeTruthy();
  });

  it('prompts for a rating once CONFIRMED', () => {
    useCompletionStore.setState({
      completion: completion({ state: 'CONFIRMED', releaseStatus: 'PENDING' }),
    });
    render(<CompletionHostScreen route={route} navigation={navigation} />);
    expect(screen.getByTestId('rating-sheet')).toBeTruthy();
  });
});

describe('CompletionCleanerScreen', () => {
  it('shows the release-status badge from releaseStatus (pending payout)', () => {
    useCompletionStore.setState({
      completion: completion({ state: 'CONFIRMED', releaseStatus: 'PENDING' }),
    });
    render(<CompletionCleanerScreen route={route} navigation={navigation} />);
    expect(screen.getByTestId('release-status-badge')).toBeTruthy();
    expect(screen.getByTestId('rating-sheet')).toBeTruthy();
  });

  it('reflects a released (ACCEPTED) completion as paid', () => {
    useCompletionStore.setState({
      completion: completion({ state: 'AUTO_RELEASED', releaseStatus: 'ACCEPTED' }),
    });
    render(<CompletionCleanerScreen route={route} navigation={navigation} />);
    // Badge renders the "released/paid" i18n key.
    expect(screen.getByText('completion.release.released')).toBeTruthy();
  });
});

describe('completion i18n parity', () => {
  function leafKeys(obj: unknown, prefix = ''): string[] {
    if (typeof obj !== 'object' || obj === null) {
      return [prefix];
    }
    return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
      leafKeys(value, prefix ? `${prefix}.${key}` : key),
    );
  }

  it('en and es completion blocks have identical key sets', () => {
    const en = (enCompletion as { completion: unknown }).completion;
    const es = (esCompletion as { completion: unknown }).completion;
    expect(leafKeys(en).sort()).toEqual(leafKeys(es).sort());
  });
});
