import { Inject, Injectable, Logger } from '@nestjs/common';
import { CommissionRateContract } from './contracts/commission-rates.interface';
import {
  SUBSCRIPTION_TIER,
  SubscriptionTierContract,
} from './contracts/subscription-tier.interface';
import { CommissionRateResolver } from './rate-resolver.service';
import {
  CleanerRateContext,
  HostRateContext,
  RateSide,
  ResolvedRate,
  SubscriberTier,
} from './commission.types';
import {
  COMMISSION_TIER_LOOKUP_TIMEOUT_MS,
  defaultRateBpsForSide,
} from './commission.constants';

/**
 * CommissionRatesProvider — the COMMISSION_RATES contract implementation.
 *
 * Orchestrates: bounded subscriber-tier lookup (safe FREE fallback on timeout/error) +
 * pure rate resolution. It NEVER throws — any failure degrades to the side's env-default
 * rate so offer creation and match are never blocked. It NEVER computes cents; consumers
 * feed the returned bps to their own CommissionService.
 */
@Injectable()
export class CommissionRatesProvider implements CommissionRateContract {
  private readonly logger = new Logger(CommissionRatesProvider.name);

  constructor(
    private readonly resolver: CommissionRateResolver,
    @Inject(SUBSCRIPTION_TIER)
    private readonly tiers: SubscriptionTierContract,
  ) {}

  async resolveHostRate(ctx: HostRateContext): Promise<ResolvedRate> {
    return this.resolve(RateSide.HOST, ctx.country, ctx.hostId, ctx.serviceType);
  }

  async resolveCleanerRate(ctx: CleanerRateContext): Promise<ResolvedRate> {
    return this.resolve(RateSide.CLEANER, ctx.country, ctx.cleanerId, ctx.serviceType);
  }

  // Previews share the exact same resolution path; the distinction is intent
  // (a preview is informational and is not snapshotted by the caller).
  async previewHostRate(ctx: HostRateContext): Promise<ResolvedRate> {
    return this.resolveHostRate(ctx);
  }

  async previewCleanerRate(ctx: CleanerRateContext): Promise<ResolvedRate> {
    return this.resolveCleanerRate(ctx);
  }

  /** Resolve one side; never throws — degrades to the env default on any error. */
  private async resolve(
    side: RateSide,
    country: string,
    userId: string,
    serviceType: string,
  ): Promise<ResolvedRate> {
    try {
      const tier = await this.lookupTier(userId);
      return this.resolver.resolveSide(side, country, tier, serviceType, new Date());
    } catch (error) {
      this.logger.error(
        `Commission rate resolution failed for ${side}; using env default`,
        error instanceof Error ? error.stack : String(error),
      );
      return { rateBps: defaultRateBpsForSide(side), ruleId: null };
    }
  }

  /**
   * Bounded tier lookup. On timeout or error, degrades to FREE (the real contract impl
   * owns the last-known-tier cache; commission-system stores no tier). Never rejects.
   */
  private async lookupTier(userId: string): Promise<SubscriberTier> {
    const timeout = new Promise<SubscriberTier>((resolve) => {
      const handle = setTimeout(() => resolve(SubscriberTier.FREE), COMMISSION_TIER_LOOKUP_TIMEOUT_MS);
      if (typeof handle.unref === 'function') {
        handle.unref();
      }
    });
    const lookup = this.tiers
      .getTier(userId)
      .catch((error: unknown) => {
        this.logger.warn(
          `Subscriber-tier lookup failed for ${userId}; degrading to FREE`,
          error instanceof Error ? error.message : String(error),
        );
        return SubscriberTier.FREE;
      });
    return Promise.race([lookup, timeout]);
  }
}
