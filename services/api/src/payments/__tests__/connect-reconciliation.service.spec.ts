import { ConnectReconciliationService } from '../connect/connect-reconciliation.service';

describe('ConnectReconciliationService', () => {
  const buildDeps = () => {
    const stripe = { retrieveAccount: jest.fn() };
    const repo = {
      findAccountsNotPayoutEnabled: jest.fn(),
      updateAccountCapabilities: jest.fn(),
    };
    const release = { releaseDeferredForCleaner: jest.fn().mockResolvedValue(0) };
    return { stripe, repo, release };
  };

  it('flips payouts_enabled and triggers deferred release when now eligible (P6)', async () => {
    const { stripe, repo, release } = buildDeps();
    stripe.retrieveAccount.mockResolvedValue({
      payouts_enabled: true,
      charges_enabled: true,
      details_submitted: true,
    });
    release.releaseDeferredForCleaner.mockResolvedValue(2);

    const service = new ConnectReconciliationService(
      stripe as never,
      repo as never,
      release as never,
    );
    await service.reconcileAccount('acct_1', 'cleaner-1');

    expect(repo.updateAccountCapabilities).toHaveBeenCalledWith(
      expect.objectContaining({ stripeAccountId: 'acct_1', payoutsEnabled: true }),
    );
    expect(release.releaseDeferredForCleaner).toHaveBeenCalledWith('cleaner-1');
  });

  it('does not trigger release when still not payable', async () => {
    const { stripe, repo, release } = buildDeps();
    stripe.retrieveAccount.mockResolvedValue({
      payouts_enabled: false,
      charges_enabled: false,
      details_submitted: false,
    });
    const service = new ConnectReconciliationService(
      stripe as never,
      repo as never,
      release as never,
    );
    await service.reconcileAccount('acct_2', 'cleaner-2');

    expect(repo.updateAccountCapabilities).toHaveBeenCalledWith(
      expect.objectContaining({ payoutsEnabled: false }),
    );
    expect(release.releaseDeferredForCleaner).not.toHaveBeenCalled();
  });

  it('sweep swallows errors and reconciles each candidate account', async () => {
    const { stripe, repo, release } = buildDeps();
    repo.findAccountsNotPayoutEnabled.mockResolvedValue([
      { stripeAccountId: 'acct_1', cleanerId: 'c1' },
      { stripeAccountId: 'acct_2', cleanerId: 'c2' },
    ]);
    stripe.retrieveAccount.mockResolvedValue({
      payouts_enabled: false,
      charges_enabled: false,
      details_submitted: false,
    });
    const service = new ConnectReconciliationService(
      stripe as never,
      repo as never,
      release as never,
    );
    await expect(service.sweep()).resolves.toBeUndefined();
    expect(stripe.retrieveAccount).toHaveBeenCalledTimes(2);
  });
});
