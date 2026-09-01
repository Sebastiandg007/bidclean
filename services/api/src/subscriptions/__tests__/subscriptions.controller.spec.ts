import { ForbiddenException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { SubscriptionsController } from '../subscriptions.controller';
import { SubscriptionsService } from '../subscriptions.service';
import { SubscriptionsRepository } from '../subscriptions.repository';
import { SubscriptionReconciliationService } from '../reconciliation/subscription-reconciliation.service';
import { Subscription } from '../entities/subscription.entity';
import { User } from '../../auth/entities/user.entity';
import { SubscriberTier } from '../subscriptions.types';

/**
 * Unit tests for SubscriptionsController + SubscriptionsService (wiring, scoping, self-heal).
 *
 * Feature: revenuecat-subscriptions
 * Validates: Requirements 4.7, 7.1, 7.2, 7.3, 7.4 (JWT-scoped /subscriptions/me from the mirror;
 * self-heal enqueued for a missing/stale row without a synchronous RevenueCat call).
 */

function futureRow(userId: string, reconciledAt: Date | null): Subscription {
  return {
    id: 'sub-1',
    userId,
    cleanerProActive: true,
    cleanerProExpiresAt: new Date(Date.now() + 86_400_000),
    cleanerProStore: 'app_store',
    cleanerProLastEventAt: null,
    hostProActive: false,
    hostProExpiresAt: null,
    hostProStore: null,
    hostProLastEventAt: null,
    adFreeActive: false,
    adFreeExpiresAt: null,
    adFreeStore: null,
    adFreeLastEventAt: null,
    lastReconciledAt: reconciledAt,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Subscription;
}

function buildController(
  row: Subscription | null,
  reconcileUser: jest.Mock,
  user: User | null = { id: 'user-1', keycloakId: 'kc-1' } as User,
): { controller: SubscriptionsController; reconcileUser: jest.Mock } {
  const repo = { findByUserId: jest.fn().mockResolvedValue(row) } as unknown as SubscriptionsRepository;
  const reconciliation = { reconcileUser } as unknown as SubscriptionReconciliationService;
  const service = new SubscriptionsService(repo, reconciliation);
  const userRepo = { findOne: jest.fn().mockResolvedValue(user) } as unknown as Repository<User>;
  return { controller: new SubscriptionsController(service, userRepo), reconcileUser };
}

function request(keycloakId: string) {
  return { user: { keycloakId } } as never;
}

describe('SubscriptionsController /subscriptions/me', () => {
  it('returns the caller PRO view from a freshly-reconciled mirror without self-heal', async () => {
    const reconcileUser = jest.fn().mockResolvedValue(undefined);
    const { controller } = buildController(futureRow('user-1', new Date()), reconcileUser);

    const view = await controller.getMe(request('kc-1'));

    expect(view.tier).toBe(SubscriberTier.PRO);
    expect(view.roleTiers.CLEANER).toBe(SubscriberTier.PRO);
    expect(view.roleTiers.HOST).toBe(SubscriberTier.FREE);
    expect(view.entitlements.map((e) => e.key)).toContain('CLEANER_PRO');
    expect(reconcileUser).not.toHaveBeenCalled();
  });

  it('returns a FREE view and triggers async self-heal when no row exists', async () => {
    const reconcileUser = jest.fn().mockResolvedValue(undefined);
    const { controller } = buildController(null, reconcileUser);

    const view = await controller.getMe(request('kc-1'));

    expect(view.tier).toBe(SubscriberTier.FREE);
    expect(view.entitlements).toEqual([]);
    expect(reconcileUser).toHaveBeenCalledWith('user-1'); // self-heal enqueued
  });

  it('triggers self-heal for a stale row (older than the staleness window)', async () => {
    const reconcileUser = jest.fn().mockResolvedValue(undefined);
    const stale = new Date(Date.now() - 1_000 * 60 * 60 * 24 * 30); // 30 days ago
    const { controller } = buildController(futureRow('user-1', stale), reconcileUser);

    await controller.getMe(request('kc-1'));

    expect(reconcileUser).toHaveBeenCalledWith('user-1');
  });

  it('rejects when the caller resolves to no user', async () => {
    const reconcileUser = jest.fn();
    const { controller } = buildController(null, reconcileUser, null);

    await expect(controller.getMe(request('kc-unknown'))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
