/**
 * Unit tests for PaywallScreen.
 *
 * Feature: revenuecat-subscriptions
 * Validates: Requirements 6.1, 6.2, 6.4 (role-appropriate offering selection; error state when
 * no offering is available; converge via the store on completion).
 *
 * The RevenueCat SDK + Paywalls UI are mocked in src/__mocks__/setup.ts.
 */

import { render, waitFor } from '@testing-library/react-native';
import Purchases from 'react-native-purchases';

import { PaywallScreen } from '../PaywallScreen';
import { SubscriberRole } from '../subscriptions.types';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Capture the props the Paywall component receives so we can assert the resolved offering.
const paywallProps: Array<{ options?: { offering?: { identifier?: string } } }> = [];
jest.mock('react-native-purchases-ui', () => ({
  __esModule: true,
  default: {
    Paywall: (props: { options?: { offering?: { identifier?: string } } }) => {
      paywallProps.push(props);
      return null;
    },
    presentPaywall: jest.fn(),
  },
}));

const mockedPurchases = Purchases as jest.Mocked<typeof Purchases>;

function offeringsWith(ids: string[]) {
  const all: Record<string, unknown> = {};
  for (const id of ids) {
    all[id] = { identifier: id, availablePackages: [] };
  }
  return { current: null, all } as never;
}

describe('PaywallScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    paywallProps.length = 0;
  });

  it('presents the Cleaner offering for a Cleaner', async () => {
    mockedPurchases.getOfferings.mockResolvedValue(offeringsWith(['cleaner_pro', 'host_pro']));

    const { queryByTestId } = render(<PaywallScreen role={SubscriberRole.CLEANER} />);

    await waitFor(() => expect(queryByTestId('paywall-screen')).not.toBeNull());
    expect(paywallProps[0]?.options?.offering?.identifier).toBe('cleaner_pro');
  });

  it('presents the Host offering for a Host', async () => {
    mockedPurchases.getOfferings.mockResolvedValue(offeringsWith(['cleaner_pro', 'host_pro']));

    const { queryByTestId } = render(<PaywallScreen role={SubscriberRole.HOST} />);

    await waitFor(() => expect(queryByTestId('paywall-screen')).not.toBeNull());
    expect(paywallProps[0]?.options?.offering?.identifier).toBe('host_pro');
  });

  it('shows the unavailable error when no offering resolves', async () => {
    mockedPurchases.getOfferings.mockResolvedValue(offeringsWith([]));

    const { queryByTestId } = render(<PaywallScreen role={SubscriberRole.CLEANER} />);

    await waitFor(() => expect(queryByTestId('paywall-error')).not.toBeNull());
  });

  it('shows the error state when fetching offerings throws', async () => {
    mockedPurchases.getOfferings.mockRejectedValue(new Error('network'));

    const { queryByTestId } = render(<PaywallScreen role={SubscriberRole.HOST} />);

    await waitFor(() => expect(queryByTestId('paywall-error')).not.toBeNull());
  });
});
