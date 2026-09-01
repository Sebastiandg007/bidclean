import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { CommissionRule } from './entities/commission-rule.entity';
import { CommissionRuleAudit } from './entities/commission-rule-audit.entity';
import { CommissionRulesRepository } from './commission-rules.repository';
import { CommissionRulesCache } from './commission-rules.cache';
import { CommissionCacheInvalidation } from './commission-cache-invalidation';
import { CommissionRateResolver } from './rate-resolver.service';
import { CommissionRatesProvider } from './commission-rates.provider';
import { CommissionAdminService } from './admin/commission-admin.service';
import { CommissionAdminController } from './admin/commission-admin.controller';
import { CommissionAdminGuard } from './guards/commission-admin.guard';
import { CommissionAdminRateLimitGuard } from './guards/commission-admin-rate-limit.guard';
import { COMMISSION_RATES } from './contracts/commission-rates.interface';
import { validateCommissionConfig } from './commission.constants';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

/**
 * Commission System module.
 *
 * Owns commission-rule resolution and configuration. Exposes the `COMMISSION_RATES` token and
 * imports `SubscriptionsModule` to consume the REAL role-aware `SUBSCRIPTION_TIER` (the
 * FREE-returning stub is retired). Coupling is one-directional (Commission -> Subscriptions) via
 * the token, and to consumers via the exported `COMMISSION_RATES` — no circular dependency.
 *
 * On init it validates config (fail-fast) and wires the ruleset cache loader to the
 * repository; the cache's initial load + Redis-invalidation subscription happen in
 * CommissionCacheInvalidation.onModuleInit.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CommissionRule, CommissionRuleAudit, User]),
    SubscriptionsModule,
  ],
  controllers: [CommissionAdminController],
  providers: [
    CommissionRulesRepository,
    CommissionRulesCache,
    CommissionCacheInvalidation,
    CommissionRateResolver,
    CommissionAdminService,
    CommissionAdminGuard,
    CommissionAdminRateLimitGuard,
    { provide: COMMISSION_RATES, useClass: CommissionRatesProvider },
  ],
  exports: [COMMISSION_RATES],
})
export class CommissionModule implements OnModuleInit {
  constructor(
    private readonly cache: CommissionRulesCache,
    private readonly repository: CommissionRulesRepository,
  ) {}

  onModuleInit(): void {
    validateCommissionConfig();
    // Wire the cache loader to the durable store. The initial load and the Redis
    // invalidation subscription are performed by CommissionCacheInvalidation.onModuleInit.
    this.cache.setLoader(() => this.repository.loadActiveRules());
  }
}
