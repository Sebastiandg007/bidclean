import { Injectable, Logger } from '@nestjs/common';
import { SubscriptionsRepository } from './subscriptions.repository';
import { SubscriptionReconciliationService } from './reconciliation/subscription-reconciliation.service';
import { Subscription } from './entities/subscription.entity';
import {
  EntitlementKey,
  EntitlementState,
  Store,
  SubscriberTier,
  SubscriptionView,
} from './subscriptions.types';
import { SUBSCRIPTION_STALE_WINDOW_MS } from './subscriptions.constants';

/**
 * Subscriptions read-model service.
 *
 * Builds the client-facing {@link SubscriptionView} (global tier + per-role tiers + active
 * entitlements) from the durable mirror. When the caller's row is missing or older than the
 * staleness window it returns the current (FREE/last-known) view immediately AND triggers an
 * asynchronous self-heal reconciliation — never a synchronous RevenueCat call on the request
 * path, so the performance budget is respected.
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly repo: SubscriptionsRepository,
    private readonly reconciliation: SubscriptionReconciliationService,
  ) {}

  /** Build the entitlement/tier view for a user, self-healing an absent/stale row async. */
  async getMyEntitlements(userId: string): Promise<SubscriptionView> {
    const row = await this.repo.findByUserId(userId);

    if (this.needsSelfHeal(row)) {
      this.triggerSelfHeal(userId);
    }

    return row ? toView(row) : emptyView();
  }

  /** A missing row, or one not reconciled within the staleness window, should self-heal. */
  private needsSelfHeal(row: Subscription | null): boolean {
    if (!row) {
      return true;
    }
    if (row.lastReconciledAt === null) {
      return true;
    }
    return Date.now() - row.lastReconciledAt.getTime() > SUBSCRIPTION_STALE_WINDOW_MS;
  }

  /** Fire-and-forget async reconciliation; failures are logged, never surfaced to the caller. */
  private triggerSelfHeal(userId: string): void {
    void this.reconciliation
      .reconcileUser(userId)
      .catch((error: unknown) =>
        this.logger.warn(
          `Self-heal reconciliation failed for ${userId}`,
          error instanceof Error ? error.message : String(error),
        ),
      );
  }
}

/** An entitlement grants access when active with a null or future expiry. */
function isActive(active: boolean, expiresAt: Date | null): boolean {
  return active && (expiresAt === null || expiresAt.getTime() > Date.now());
}

function entitlement(
  key: EntitlementKey,
  active: boolean,
  expiresAt: Date | null,
  store: Store | null,
): EntitlementState {
  return { key, active: isActive(active, expiresAt), expiresAt: expiresAt?.toISOString() ?? null, store };
}

/** Project a mirror row into the client-facing view (tier derived, not stored). */
function toView(row: Subscription): SubscriptionView {
  const entitlements: EntitlementState[] = [
    entitlement(EntitlementKey.CLEANER_PRO, row.cleanerProActive, row.cleanerProExpiresAt, row.cleanerProStore),
    entitlement(EntitlementKey.HOST_PRO, row.hostProActive, row.hostProExpiresAt, row.hostProStore),
    entitlement(EntitlementKey.AD_FREE, row.adFreeActive, row.adFreeExpiresAt, row.adFreeStore),
  ];

  const cleanerPro = isActive(row.cleanerProActive, row.cleanerProExpiresAt);
  const hostPro = isActive(row.hostProActive, row.hostProExpiresAt);

  return {
    tier: cleanerPro || hostPro ? SubscriberTier.PRO : SubscriberTier.FREE,
    roleTiers: {
      HOST: hostPro ? SubscriberTier.PRO : SubscriberTier.FREE,
      CLEANER: cleanerPro ? SubscriberTier.PRO : SubscriberTier.FREE,
    },
    entitlements: entitlements.filter((state) => state.active),
  };
}

/** The FREE view returned when a user has no mirror row yet. */
function emptyView(): SubscriptionView {
  return {
    tier: SubscriberTier.FREE,
    roleTiers: { HOST: SubscriberTier.FREE, CLEANER: SubscriberTier.FREE },
    entitlements: [],
  };
}
