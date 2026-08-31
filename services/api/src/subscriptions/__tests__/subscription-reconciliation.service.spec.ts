import { SubscriptionReconciliationService } from '../reconciliation/subscription-reconciliation.service';
import { SubscriptionsRepository } from '../subscriptions.repository';
import { RevenueCatClient, RevenueCatSubscriber } from '../revenuecat/revenuecat.client';
import { Subscription } from '../entities/subscription.entity';
import { EntitlementKey, Store } from '../subscriptions.types';

/**
 * Unit tests for SubscriptionReconciliationService.
 *
 * Feature: revenuecat-subscriptions
 * Validates: Requirements 4.1, 4.3, 4.5, 4.6, P6, P18 (converge stale rows; no-op when correct;
 * discover missing subscribers; RevenueCat outage leaves the mirror untouched).
 */

interface RepoMocks {
  findStaleForReconciliation: jest.Mock;
  findLedgerUserIdsWithoutMirror: jest.Mock;
  upsertFromReconcile: jest.Mock;
}

function buildService(
  repoOverrides: Partial<RepoMocks>,
  getSubscriber: jest.Mock,
): { service: SubscriptionReconciliationService; mocks: RepoMocks } {
  const mocks: RepoMocks = {
    findStaleForReconciliation: jest.fn().mockResolvedValue([]),
    findLedgerUserIdsWithoutMirror: jest.fn().mockResolvedValue([]),
    upsertFromReconcile: jest.fn().mockResolvedValue(undefined),
    ...repoOverrides,
  };
  const repo = mocks as unknown as SubscriptionsRepository;
  const client = { getSubscriber } as unknown as RevenueCatClient;
  return { service: new SubscriptionReconciliationService(repo, client), mocks };
}

function staleRow(userId: string): Subscription {
  return { id: `sub-${userId}`, userId } as unknown as Subscription;
}

function snapshot(userId: string): RevenueCatSubscriber {
  return {
    userId,
    entitlements: [
      { key: EntitlementKey.CLEANER_PRO, active: true, expiresAt: new Date(Date.now() + 86_400_000), store: Store.APP_STORE },
    ],
  };
}

describe('SubscriptionReconciliationService', () => {
  it('converges a stale row against the RevenueCat snapshot', async () => {
    const getSubscriber = jest.fn().mockResolvedValue(snapshot('user-1'));
    const { service, mocks } = buildService(
      { findStaleForReconciliation: jest.fn().mockResolvedValue([staleRow('user-1')]) },
      getSubscriber,
    );

    await service.sweep();

    expect(getSubscriber).toHaveBeenCalledWith('user-1');
    expect(mocks.upsertFromReconcile).toHaveBeenCalledTimes(1);
    const [reconciled] = mocks.upsertFromReconcile.mock.calls[0] as [RevenueCatSubscriber, Date];
    expect(reconciled.userId).toBe('user-1');
    expect(reconciled.entitlements[0]?.key).toBe('CLEANER_PRO');
  });

  it('leaves the mirror untouched when RevenueCat is unreachable (snapshot null)', async () => {
    const getSubscriber = jest.fn().mockResolvedValue(null);
    const { service, mocks } = buildService(
      { findStaleForReconciliation: jest.fn().mockResolvedValue([staleRow('user-1')]) },
      getSubscriber,
    );

    await service.sweep();

    expect(mocks.upsertFromReconcile).not.toHaveBeenCalled();
  });

  it('discovers missing subscribers and creates their rows from RC truth (P18)', async () => {
    const getSubscriber = jest.fn().mockResolvedValue(snapshot('new-user'));
    const { service, mocks } = buildService(
      { findLedgerUserIdsWithoutMirror: jest.fn().mockResolvedValue(['new-user']) },
      getSubscriber,
    );

    await service.sweep();

    expect(getSubscriber).toHaveBeenCalledWith('new-user');
    expect(mocks.upsertFromReconcile).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when there are no stale rows and no missing subscribers', async () => {
    const getSubscriber = jest.fn();
    const { service, mocks } = buildService({}, getSubscriber);

    await service.sweep();

    expect(getSubscriber).not.toHaveBeenCalled();
    expect(mocks.upsertFromReconcile).not.toHaveBeenCalled();
  });

  it('does not throw when a repository query fails', async () => {
    const getSubscriber = jest.fn();
    const { service } = buildService(
      { findStaleForReconciliation: jest.fn().mockRejectedValue(new Error('db down')) },
      getSubscriber,
    );

    await expect(service.sweep()).resolves.toBeUndefined();
  });
});
