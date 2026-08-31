import { Injectable, Logger } from '@nestjs/common';
import { StripeClient } from '../stripe/stripe.client';
import { PaymentsRepository } from '../payments.repository';
import {
  STRIPE_CONNECT_ACCOUNT_TYPE,
  STRIPE_ONBOARDING_REFRESH_URL,
  STRIPE_ONBOARDING_RETURN_URL,
} from '../payments.constants';
import { StripeAccountStatus } from '../payments.types';

/**
 * Connect onboarding service.
 *
 * Creates or reuses a single Express Connected Account per Cleaner, generates the
 * hosted onboarding Account Link, and syncs capability flags. Payout eligibility is
 * defined solely by `payouts_enabled === true`. Never leaks Stripe secrets.
 */
@Injectable()
export class ConnectOnboardingService {
  private readonly logger = new Logger(ConnectOnboardingService.name);

  constructor(
    private readonly stripe: StripeClient,
    private readonly repo: PaymentsRepository,
  ) {}

  /**
   * Start (or resume) Cleaner onboarding: ensure a Connected Account exists, then
   * return a fresh onboarding Account Link URL.
   */
  async startOnboarding(cleanerId: string): Promise<{ onboardingUrl: string }> {
    const account = await this.ensureAccount(cleanerId);
    const link = await this.stripe.createAccountLink({
      account: account.stripeAccountId,
      refresh_url: STRIPE_ONBOARDING_REFRESH_URL,
      return_url: STRIPE_ONBOARDING_RETURN_URL,
      type: 'account_onboarding',
    });
    return { onboardingUrl: link.url };
  }

  /** Return the Cleaner's account capability status (no secrets). */
  async getAccountStatus(cleanerId: string): Promise<StripeAccountStatus> {
    const account = await this.repo.findAccountByCleaner(cleanerId);
    if (!account) {
      return {
        hasAccount: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        country: null,
        defaultCurrency: null,
      };
    }
    return {
      hasAccount: true,
      chargesEnabled: account.chargesEnabled,
      payoutsEnabled: account.payoutsEnabled,
      detailsSubmitted: account.detailsSubmitted,
      country: account.country,
      defaultCurrency: account.defaultCurrency,
    };
  }

  /**
   * Create the Cleaner's Express account if missing, or reuse the existing one
   * (enforced by `uq_stripe_account_cleaner`). Persists current capability flags.
   */
  private async ensureAccount(cleanerId: string): Promise<{ stripeAccountId: string }> {
    const existing = await this.repo.findAccountByCleaner(cleanerId);
    if (existing) {
      return { stripeAccountId: existing.stripeAccountId };
    }

    const account = await this.stripe.createConnectedAccount({
      type: STRIPE_CONNECT_ACCOUNT_TYPE as 'express',
      capabilities: {
        transfers: { requested: true },
      },
      metadata: { cleanerId },
    });

    await this.repo.upsertStripeAccount({
      cleanerId,
      stripeAccountId: account.id,
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
      detailsSubmitted: account.details_submitted ?? false,
      country: account.country ?? null,
      defaultCurrency: account.default_currency ?? null,
    });

    this.logger.log(`Created Stripe Express account for cleaner ${cleanerId}`);
    return { stripeAccountId: account.id };
  }
}
