/**
 * Unit tests for ProBadge.
 *
 * Feature: revenuecat-subscriptions
 * Validates: Requirements 1.7, 5.5 (badge gated per-role from the server view; a user PRO in one
 * role and FREE in the other shows the badge only in the PRO role's view).
 */

import { render } from '@testing-library/react-native';

import { ProBadge } from '../components/ProBadge';
import { useSubscriptionStore } from '../useSubscription';
import { SubscriberRole, SubscriberTier } from '../subscriptions.types';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function setServerView(host: SubscriberTier, cleaner: SubscriberTier): void {
  useSubscriptionStore.setState({
    serverView: {
      tier: host === SubscriberTier.PRO || cleaner === SubscriberTier.PRO ? SubscriberTier.PRO : SubscriberTier.FREE,
      roleTiers: { HOST: host, CLEANER: cleaner },
      entitlements: [],
    },
  });
}

describe('ProBadge', () => {
  afterEach(() => useSubscriptionStore.getState().reset());

  it('renders for the Cleaner role when cleaner tier is PRO', () => {
    setServerView(SubscriberTier.FREE, SubscriberTier.PRO);
    const { queryByTestId } = render(<ProBadge role={SubscriberRole.CLEANER} />);
    expect(queryByTestId('pro-badge')).not.toBeNull();
  });

  it('does not render for the Host role when host tier is FREE (the mixed-role case)', () => {
    setServerView(SubscriberTier.FREE, SubscriberTier.PRO);
    const { queryByTestId } = render(<ProBadge role={SubscriberRole.HOST} />);
    expect(queryByTestId('pro-badge')).toBeNull();
  });

  it('renders for the Host role when host tier is PRO', () => {
    setServerView(SubscriberTier.PRO, SubscriberTier.FREE);
    const { queryByTestId } = render(<ProBadge role={SubscriberRole.HOST} />);
    expect(queryByTestId('pro-badge')).not.toBeNull();
  });

  it('renders nothing when there is no server view', () => {
    useSubscriptionStore.setState({ serverView: null });
    const { queryByTestId } = render(<ProBadge role={SubscriberRole.CLEANER} />);
    expect(queryByTestId('pro-badge')).toBeNull();
  });
});
