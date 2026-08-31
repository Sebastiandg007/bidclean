import { RealSubscriptionTierService } from '../subscription-tier.service';
import { SubscriptionsRepository } from '../subscriptions.repository';
import { Subscription } from '../entities/subscription.entity';
import { SubscriberRole, SubscriberTier } from '../../commission/commission.types';

/**
 * Unit tests for RealSubscriptionTierService.
 *
 * Feature: revenuecat-subscriptions
 * Validates: Requirements 1.2, 1.3, 1.5, 1.7, 1.8 (role-aware derivation, expiry respected,
 * empty mirror -> FREE, ad_free never implies PRO).
 */

const FUTURE = new Date(Date.now() + 60_000);
const PAST = new Date(Date.now() - 60_000);

function mirror(overrides: Partial<Subscription>): Subscription {
  return {
    id: 'sub-1',
    userId: 'user-1',
    cleanerProActive: false,
    cleanerProExpiresAt: null,
    cleanerProStore: null,
    cleanerProLastEventAt: null,
    hostProActive: false,
    hostProExpiresAt: null,
    hostProStore: null,
    hostProLastEventAt: null,
    adFreeActive: false,
    adFreeExpiresAt: null,
    adFreeStore: null,
    adFreeLastEventAt: null,
    lastReconciledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function repoReturning(row: Subscription | null): SubscriptionsRepository {
  return { findByUserId: async () => row } as unknown as SubscriptionsRepository;
}

describe('RealSubscriptionTierService', () => {
  it('resolves FREE for both roles and global when no mirror row exists', async () => {
    const svc = new RealSubscriptionTierService(repoReturning(null));
    await expect(svc.getRoleTier('u', SubscriberRole.HOST)).resolves.toBe(SubscriberTier.FREE);
    await expect(svc.getRoleTier('u', SubscriberRole.CLEANER)).resolves.toBe(SubscriberTier.FREE);
    await expect(svc.getTier('u')).resolves.toBe(SubscriberTier.FREE);
  });

  it('resolves PRO for an active entitlement with a future expiry', async () => {
    const svc = new RealSubscriptionTierService(
      repoReturning(mirror({ cleanerProActive: true, cleanerProExpiresAt: FUTURE })),
    );
    await expect(svc.getRoleTier('u', SubscriberRole.CLEANER)).resolves.toBe(SubscriberTier.PRO);
  });

  it('resolves PRO for an active entitlement with a null (open-ended) expiry', async () => {
    const svc = new RealSubscriptionTierService(
      repoReturning(mirror({ hostProActive: true, hostProExpiresAt: null })),
    );
    await expect(svc.getRoleTier('u', SubscriberRole.HOST)).resolves.toBe(SubscriberTier.PRO);
  });

  it('resolves FREE for an active entitlement whose expiry is in the past', async () => {
    const svc = new RealSubscriptionTierService(
      repoReturning(mirror({ cleanerProActive: true, cleanerProExpiresAt: PAST })),
    );
    await expect(svc.getRoleTier('u', SubscriberRole.CLEANER)).resolves.toBe(SubscriberTier.FREE);
  });

  it('resolves FREE for an inactive entitlement even with a future expiry', async () => {
    const svc = new RealSubscriptionTierService(
      repoReturning(mirror({ hostProActive: false, hostProExpiresAt: FUTURE })),
    );
    await expect(svc.getRoleTier('u', SubscriberRole.HOST)).resolves.toBe(SubscriberTier.FREE);
  });

  it('resolves per role independently (Host PRO, Cleaner FREE — the P0 case)', async () => {
    const svc = new RealSubscriptionTierService(
      repoReturning(mirror({ hostProActive: true, hostProExpiresAt: FUTURE })),
    );
    await expect(svc.getRoleTier('u', SubscriberRole.HOST)).resolves.toBe(SubscriberTier.PRO);
    await expect(svc.getRoleTier('u', SubscriberRole.CLEANER)).resolves.toBe(SubscriberTier.FREE);
    await expect(svc.getTier('u')).resolves.toBe(SubscriberTier.PRO); // global = OR of roles
  });

  it('does NOT derive PRO from ad_free alone', async () => {
    const svc = new RealSubscriptionTierService(
      repoReturning(mirror({ adFreeActive: true, adFreeExpiresAt: FUTURE })),
    );
    await expect(svc.getRoleTier('u', SubscriberRole.HOST)).resolves.toBe(SubscriberTier.FREE);
    await expect(svc.getRoleTier('u', SubscriberRole.CLEANER)).resolves.toBe(SubscriberTier.FREE);
    await expect(svc.getTier('u')).resolves.toBe(SubscriberTier.FREE);
  });
});
