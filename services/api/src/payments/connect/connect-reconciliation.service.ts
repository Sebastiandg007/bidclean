import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { StripeClient } from '../stripe/stripe.client';
import { PaymentsRepository } from '../payments.repository';
import { EscrowReleaseService } from '../escrow/escrow-release.service';
import { CONNECT_RECONCILE_INTERVAL_MS } from '../payments.constants';

/** Max accounts reconciled per sweep (bounded work per tick) */
const RECONCILE_BATCH_SIZE = 50;

/**
 * Connected-account reconciliation service.
 *
 * Periodically retrieves Stripe accounts that are not yet payout-enabled, repairs
 * their capability flags, and triggers deferred payouts for newly-eligible Cleaners.
 * This does NOT rely solely on `account.updated` webhooks (P6, P11).
 */
@Injectable()
export class ConnectReconciliationService {
  private readonly logger = new Logger(ConnectReconciliationService.name);

  constructor(
    private readonly stripe: StripeClient,
    private readonly repo: PaymentsRepository,
    private readonly release: EscrowReleaseService,
  ) {}

  /** Sweep interval resolved from configuration. */
  static getInterval(): number {
    return CONNECT_RECONCILE_INTERVAL_MS;
  }

  /** Reconcile not-yet-payable accounts against Stripe. */
  @Interval(ConnectReconciliationService.getInterval())
  async sweep(): Promise<void> {
    try {
      const accounts = await this.repo.findAccountsNotPayoutEnabled(RECONCILE_BATCH_SIZE);
      for (const account of accounts) {
        await this.reconcileAccount(account.stripeAccountId, account.cleanerId);
      }
    } catch (error) {
      this.logger.error(`Connect reconciliation sweep failed: ${String(error)}`);
    }
  }

  /** Retrieve one account, repair flags, and release deferred payouts if now eligible. */
  async reconcileAccount(stripeAccountId: string, cleanerId: string): Promise<void> {
    const account = await this.stripe.retrieveAccount(stripeAccountId);
    const nowPayable = account.payouts_enabled === true;

    await this.repo.updateAccountCapabilities({
      stripeAccountId,
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: nowPayable,
      detailsSubmitted: account.details_submitted ?? false,
    });

    if (nowPayable) {
      const released = await this.release.releaseDeferredForCleaner(cleanerId);
      if (released > 0) {
        this.logger.log(`Reconciliation released ${released} deferred payout(s) for ${cleanerId}`);
      }
    }
  }
}
