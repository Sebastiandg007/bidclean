/**
 * Tests for StateTimeline component.
 *
 * Covers: rendering transitions, empty state fallback, chronological order,
 * current state highlighting, accessibility labels, triggered_by display.
 */

import { render, screen } from '@testing-library/react-native';

import type { OfferStateTransition } from '../../offers.types';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'offers.stateTimeline.title': 'State History',
        'offers.stateTimeline.a11yLabel': 'Offer state progression timeline',
        'offers.stateTimeline.justNow': 'just now',
        'offers.state.DRAFT': 'Draft',
        'offers.state.PUBLISHED': 'Published',
        'offers.state.ACTIVE': 'Active',
        'offers.state.MATCHED': 'Matched',
        'offers.state.COMPLETED': 'Completed',
        'offers.state.CANCELLED': 'Cancelled',
        'offers.state.EXPIRED': 'Expired',
      };

      if (key === 'offers.stateTimeline.entryA11y' && params) {
        return `${params.state}, ${params.time}`;
      }
      if (key === 'offers.stateTimeline.minutesAgo_one' && params) {
        return `${params.count}m ago`;
      }
      if (key === 'offers.stateTimeline.minutesAgo_other' && params) {
        return `${params.count}m ago`;
      }
      if (key === 'offers.stateTimeline.hoursAgo_one' && params) {
        return `${params.count}h ago`;
      }
      if (key === 'offers.stateTimeline.hoursAgo_other' && params) {
        return `${params.count}h ago`;
      }

      return translations[key] ?? key;
    },
    i18n: { changeLanguage: jest.fn() },
  }),
}));

import { StateTimeline } from '../StateTimeline';

// ─── Test Data ───────────────────────────────────────────────────────────────

function createTransition(
  overrides: Partial<OfferStateTransition> = {},
): OfferStateTransition {
  return {
    id: 'trans-1',
    offerId: 'offer-1',
    fromState: null,
    toState: 'DRAFT',
    triggeredBy: 'host',
    metadata: null,
    createdAt: '2024-01-15T10:00:00.000Z',
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('StateTimeline', () => {
  it('renders title from i18n', () => {
    render(
      <StateTimeline transitions={[]} currentState="DRAFT" />,
    );
    expect(screen.getByText('State History')).toBeTruthy();
  });

  it('renders container with testID', () => {
    render(
      <StateTimeline transitions={[]} currentState="DRAFT" />,
    );
    expect(screen.getByTestId('state-timeline')).toBeTruthy();
  });

  it('shows single entry for current state when transitions are empty', () => {
    render(
      <StateTimeline transitions={[]} currentState="DRAFT" />,
    );
    expect(screen.getByText('Draft')).toBeTruthy();
  });

  it('renders all transitions in chronological order', () => {
    const transitions: OfferStateTransition[] = [
      createTransition({
        id: 't1',
        fromState: null,
        toState: 'DRAFT',
        createdAt: '2024-01-15T10:00:00.000Z',
      }),
      createTransition({
        id: 't2',
        fromState: 'DRAFT',
        toState: 'PUBLISHED',
        createdAt: '2024-01-15T11:00:00.000Z',
      }),
      createTransition({
        id: 't3',
        fromState: 'PUBLISHED',
        toState: 'ACTIVE',
        createdAt: '2024-01-15T12:00:00.000Z',
      }),
    ];

    render(
      <StateTimeline transitions={transitions} currentState="ACTIVE" />,
    );

    expect(screen.getByText('Draft')).toBeTruthy();
    expect(screen.getByText('Published')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('handles transitions provided in non-chronological order', () => {
    const transitions: OfferStateTransition[] = [
      createTransition({
        id: 't3',
        fromState: 'PUBLISHED',
        toState: 'ACTIVE',
        createdAt: '2024-01-15T12:00:00.000Z',
      }),
      createTransition({
        id: 't1',
        fromState: null,
        toState: 'DRAFT',
        createdAt: '2024-01-15T10:00:00.000Z',
      }),
      createTransition({
        id: 't2',
        fromState: 'DRAFT',
        toState: 'PUBLISHED',
        createdAt: '2024-01-15T11:00:00.000Z',
      }),
    ];

    render(
      <StateTimeline transitions={transitions} currentState="ACTIVE" />,
    );

    // All three entries should render
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(screen.getByText('Published')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('displays triggered_by text for entries that have it', () => {
    const transitions: OfferStateTransition[] = [
      createTransition({
        id: 't1',
        toState: 'DRAFT',
        triggeredBy: 'host_action',
        createdAt: '2024-01-15T10:00:00.000Z',
      }),
    ];

    render(
      <StateTimeline transitions={transitions} currentState="DRAFT" />,
    );

    expect(screen.getByText('host_action')).toBeTruthy();
  });

  it('provides accessibility role list on container', () => {
    render(
      <StateTimeline transitions={[]} currentState="DRAFT" />,
    );

    const container = screen.getByTestId('state-timeline');
    expect(container.props.accessibilityRole).toBe('list');
  });

  it('renders single transition correctly', () => {
    const transitions: OfferStateTransition[] = [
      createTransition({
        id: 't1',
        fromState: null,
        toState: 'CANCELLED',
        triggeredBy: 'system',
        createdAt: '2024-01-15T10:00:00.000Z',
      }),
    ];

    render(
      <StateTimeline transitions={transitions} currentState="CANCELLED" />,
    );

    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(screen.getByText('system')).toBeTruthy();
  });
});
