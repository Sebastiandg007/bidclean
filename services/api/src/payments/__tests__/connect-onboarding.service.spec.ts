import { ConnectOnboardingService } from '../connect/connect-onboarding.service';

describe('ConnectOnboardingService', () => {
  const buildStripe = () => ({
    createConnectedAccount: jest.fn(),
    createAccountLink: jest.fn(),
    retrieveAccount: jest.fn(),
  });

  const buildRepo = () => ({
    findAccountByCleaner: jest.fn(),
    upsertStripeAccount: jest.fn(),
  });

  it('creates a new account only when none exists (single account per cleaner)', async () => {
    const stripe = buildStripe();
    const repo = buildRepo();
    repo.findAccountByCleaner.mockResolvedValue(null);
    stripe.createConnectedAccount.mockResolvedValue({
      id: 'acct_1',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      country: 'US',
      default_currency: 'usd',
    });
    stripe.createAccountLink.mockResolvedValue({ url: 'https://connect.stripe.com/onboard/x' });

    const service = new ConnectOnboardingService(stripe as never, repo as never);
    const result = await service.startOnboarding('cleaner-1');

    expect(result.onboardingUrl).toContain('https://');
    expect(stripe.createConnectedAccount).toHaveBeenCalledTimes(1);
    expect(repo.upsertStripeAccount).toHaveBeenCalledTimes(1);
  });

  it('reuses an existing account (does not create a second)', async () => {
    const stripe = buildStripe();
    const repo = buildRepo();
    repo.findAccountByCleaner.mockResolvedValue({ stripeAccountId: 'acct_existing' });
    stripe.createAccountLink.mockResolvedValue({ url: 'https://connect.stripe.com/onboard/y' });

    const service = new ConnectOnboardingService(stripe as never, repo as never);
    await service.startOnboarding('cleaner-1');

    expect(stripe.createConnectedAccount).not.toHaveBeenCalled();
    expect(stripe.createAccountLink).toHaveBeenCalledWith(
      expect.objectContaining({ account: 'acct_existing', type: 'account_onboarding' }),
    );
  });

  it('reports no account status when the cleaner has not onboarded', async () => {
    const stripe = buildStripe();
    const repo = buildRepo();
    repo.findAccountByCleaner.mockResolvedValue(null);
    const service = new ConnectOnboardingService(stripe as never, repo as never);
    const status = await service.getAccountStatus('cleaner-2');
    expect(status.hasAccount).toBe(false);
    expect(status.payoutsEnabled).toBe(false);
  });

  it('reflects capability flags from the persisted account', async () => {
    const stripe = buildStripe();
    const repo = buildRepo();
    repo.findAccountByCleaner.mockResolvedValue({
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      country: 'CA',
      defaultCurrency: 'cad',
    });
    const service = new ConnectOnboardingService(stripe as never, repo as never);
    const status = await service.getAccountStatus('cleaner-3');
    expect(status).toMatchObject({ hasAccount: true, payoutsEnabled: true, country: 'CA' });
  });
});
