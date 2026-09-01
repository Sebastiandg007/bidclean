import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { SubscriptionsRepository, ReconciledSubscriber } from '../subscriptions.repository';
import { RevenueCatClient } from '../revenuecat/revenuecat.client';
import {
  SUBSCRIPTION_RECONCILE_INTERVAL_MS,
  SUBSCRIPTION_RECONCILE_BATCH,
  SUBSCRIPTION_STALE_WINDOW_MS,
} from '../subscriptions.constants';

/**
 * Subscription reconciliation backstop.
 *
 * Two passes each sweep:
 *  1. CONVERGE — refresh stale/never-reconciled mirror rows against RevenueCat's authoritative
 *     subscriber state (idempotent no-op when already correct, P6).
 *  2. DISCOVER — create mirror rows for known RevenueCat subscribers that have no row yet
 *     (a webhook was missed), sourced from the ledger (P18).
 *
 * RevenueCat unreachable -> log + skip that row, retry next interval; the mirror is never
 * corrupted (P8). Reconciliation is the final arbiter over ambiguous webhook transitions.
 */
@Injectable()
export class SubscriptionReconciliationService {
  private readonly logger = new Logger(SubscriptionReconciliationService.name);

  constructor(
    private readonly repo: SubscriptionsRepository,
    private readonly revenueCat: RevenueCatClient,
  ) {}

  /** Sweep interval resolved from configuration. */
  static getInterval(): number {
    return SUBSCRIPTION_RECONCILE_INTERVAL_MS;
  }

  @Interval(SubscriptionReconciliationService.getInterval())
  async sweep(): Promise<void> {
    try {
      await this.convergeStaleRows();
      await this.discoverMissingSubscribers();
    } catch (error) {
      this.logger.error(`Reconciliation sweep failed: ${String(error)}`);
    }
  }

  /** Pass 1: converge stale/never-reconciled rows to RevenueCat truth. */
  private async convergeStaleRows(): Promise<void> {
    const stale = await this.repo.findStaleForReconciliation(
      SUBSCRIPTION_STALE_WINDOW_MS,
      SUBSCRIPTION_RECONCILE_BATCH,
    );
    for (const row of stale) {
      await this.reconcileUser(row.userId);
    }
    if (stale.length > 0) {
      this.logger.debug(`Reconciliation converged ${stale.length} row(s)`);
    }
  }

  /** Pass 2: discover known subscribers with no mirror row and create them from RC truth. */
  private async discoverMissingSubscribers(): Promise<void> {
    const missing = await this.repo.findLedgerUserIdsWithoutMirror(SUBSCRIPTION_RECONCILE_BATCH);
    for (const userId of missing) {
      await this.reconcileUser(userId);
    }
    if (missing.length > 0) {
      this.logger.debug(`Reconciliation discovered ${missing.length} missing subscriber row(s)`);
    }
  }

  /**
   * Reconcile one user: fetch the authoritative snapshot and converge the mirror. When
   * RevenueCat is unreachable (snapshot null) the row is left untouched and retried next sweep.
   */
  async reconcileUser(userId: string): Promise<void> {
    const snapshot = await this.revenueCat.getSubscriber(userId);
    if (snapshot === null) {
      this.logger.warn(`RevenueCat unreachable for ${userId}; leaving mirror untouched`);
      return;
    }
    const reconciled: ReconciledSubscriber = { userId: snapshot.userId, entitlements: snapshot.entitlements };
    await this.repo.upsertFromReconcile(reconciled, new Date());
  }
}
