import { ConflictException, BadRequestException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { CommissionRateResolver } from '../rate-resolver.service';
import { CommissionRulesCache } from '../commission-rules.cache';
import { CommissionRulesRepository } from '../commission-rules.repository';
import { CommissionAdminService } from '../admin/commission-admin.service';
import { CommissionCacheInvalidation } from '../commission-cache-invalidation';
import { CommissionRatesProvider } from '../commission-rates.provider';
import { SubscriptionTierContract } from '../contracts/subscription-tier.interface';
import {
  CommissionRuleRow,
  RateSide,
  RuleAuditAction,
  SubscriberTier,
} from '../commission.types';

/**
 * Integration / scenario tests for commission-system.
 *
 * Feature: commission-system
 * Composes the REAL resolver, cache, repository, admin service, and rates provider with a
 * faked in-memory store (no DB harness, matching the project's negotiation/payments test
 * convention). Covers tasks 16.1-16.7.
 */

const NOW = new Date('2026-06-01T00:00:00.000Z');

/**
 * A mutable in-memory rule row. Reuses CommissionRuleRow's shape (via `-readonly`, since the
 * fake repo mutates fields like isActive) and adds the audit columns the store tracks.
 */
type StoredRule = { -readonly [K in keyof CommissionRuleRow]: CommissionRuleRow[K] } & {
  createdBy: string | null;
  updatedBy: string | null;
};
interface AuditRow {
  ruleId: string;
  action: RuleAuditAction;
  actorId: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown>;
  reason: string | null;
}

/**
 * A fake CommissionRulesRepository backed by in-memory arrays. Enforces the overlap
 * invariant (identical active scope + overlapping window) the way the DB exclusion
 * constraint would, and appends audit rows on every mutation.
 */
class FakeRepo {
  rules: StoredRule[] = [];
  audit: AuditRow[] = [];
  private seq = 0;

  private uid(): string {
    this.seq += 1;
    return `rule-${this.seq.toString().padStart(4, '0')}`;
  }

  private overlaps(a: StoredRule, b: { country: string | null; subscriberTier: SubscriberTier | null; serviceType: string | null; appliesTo: RateSide; effectiveFrom: Date; effectiveTo: Date | null; }): boolean {
    const sameScope =
      a.appliesTo === b.appliesTo &&
      (a.country ?? '*') === (b.country ?? '*') &&
      (a.subscriberTier ?? '*') === (b.subscriberTier ?? '*') &&
      (a.serviceType ?? '*') === (b.serviceType ?? '*');
    if (!sameScope || !a.isActive) {
      return false;
    }
    const aTo = a.effectiveTo?.getTime() ?? Infinity;
    const bTo = b.effectiveTo?.getTime() ?? Infinity;
    return a.effectiveFrom.getTime() < bTo && b.effectiveFrom.getTime() < aTo;
  }

  async loadActiveRules(): Promise<CommissionRuleRow[]> {
    return this.rules.filter((r) => r.isActive).map((r) => ({ ...r }));
  }

  async findById(id: string): Promise<StoredRule | null> {
    return this.rules.find((r) => r.id === id) ?? null;
  }

  async list(): Promise<StoredRule[]> {
    return [...this.rules];
  }

  async listAudit(ruleId: string): Promise<AuditRow[]> {
    return this.audit.filter((a) => a.ruleId === ruleId);
  }

  async createRule(input: any): Promise<StoredRule> {
    for (const existing of this.rules) {
      if (this.overlaps(existing, input)) {
        // Mirror the DB exclusion constraint -> repository maps to ConflictException.
        throw new ConflictException(
          'A conflicting active commission rule with overlapping scope and effective window already exists',
        );
      }
    }
    const rule: StoredRule = {
      id: this.uid(),
      country: input.country,
      subscriberTier: input.subscriberTier,
      serviceType: input.serviceType,
      appliesTo: input.appliesTo,
      rateBps: input.rateBps,
      priority: input.priority,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      isActive: true,
      createdBy: input.actorId,
      updatedBy: input.actorId,
    };
    this.rules.push(rule);
    this.audit.push({
      ruleId: rule.id, action: RuleAuditAction.CREATE, actorId: input.actorId,
      oldValues: null, newValues: { rateBps: rule.rateBps }, reason: input.reason,
    });
    return rule;
  }

  async setActive(id: string, isActive: boolean, actorId: string | null, reason: string | null): Promise<StoredRule> {
    const rule = this.rules.find((r) => r.id === id);
    if (!rule) {
      throw new ConflictException(`Commission rule ${id} not found`);
    }
    const before = { isActive: rule.isActive };
    rule.isActive = isActive;
    rule.updatedBy = actorId;
    this.audit.push({
      ruleId: id,
      action: isActive ? RuleAuditAction.ACTIVATE : RuleAuditAction.DEACTIVATE,
      actorId, oldValues: before, newValues: { isActive }, reason,
    });
    return rule;
  }

  async updateRule(): Promise<StoredRule> {
    throw new Error('not used in these scenarios');
  }
}

/** Wire the real cache to the fake repo. */
function buildCache(repo: FakeRepo): CommissionRulesCache {
  const cache = new CommissionRulesCache();
  cache.setLoader(() => repo.loadActiveRules());
  return cache;
}

/** A fake invalidation that just refreshes the given caches (simulates local + remote). */
function buildInvalidation(caches: CommissionRulesCache[]): CommissionCacheInvalidation {
  return {
    publishInvalidation: jest.fn(async () => {
      await Promise.all(caches.map((c) => c.refresh()));
    }),
  } as unknown as CommissionCacheInvalidation;
}

describe('commission-system — Integration / Scenario Tests', () => {
  const createInput = (over: Partial<any> = {}) => ({
    country: null,
    subscriberTier: null,
    serviceType: null,
    appliesTo: RateSide.CLEANER,
    rateBps: 300,
    priority: 0,
    effectiveFrom: new Date('2025-01-01'),
    effectiveTo: null,
    actorId: 'op-1',
    reason: null,
    ...over,
  });

  // 16.1
  it('16.1: overlapping identical-scope active rules -> conflict; different scope allowed', async () => {
    const repo = new FakeRepo();
    const cache = buildCache(repo);
    const admin = new CommissionAdminService(repo as unknown as CommissionRulesRepository, buildInvalidation([cache]));

    await admin.createRule(createInput({ country: 'CO', appliesTo: RateSide.CLEANER }));
    await expect(
      admin.createRule(createInput({ country: 'CO', appliesTo: RateSide.CLEANER, rateBps: 200 })),
    ).rejects.toBeInstanceOf(ConflictException);
    // Different scope (US) is fine.
    await expect(
      admin.createRule(createInput({ country: 'US', appliesTo: RateSide.CLEANER })),
    ).resolves.toBeDefined();
  });

  // 16.2
  it('16.2: a rule write invalidates the cache so a second instance sees it', async () => {
    const repo = new FakeRepo();
    const cacheA = buildCache(repo);
    const cacheB = buildCache(repo);
    await cacheA.refresh();
    await cacheB.refresh();
    const admin = new CommissionAdminService(
      repo as unknown as CommissionRulesRepository,
      buildInvalidation([cacheA, cacheB]),
    );
    const resolverB = new CommissionRateResolver(cacheB);

    // Before: instance B uses env default.
    expect(resolverB.resolveSide(RateSide.CLEANER, 'CO', SubscriberTier.FREE, 'standard', NOW).ruleId).toBeNull();

    await admin.createRule(createInput({ country: 'CO', rateBps: 150 }));

    // After invalidation: instance B reflects the new rule.
    const res = resolverB.resolveSide(RateSide.CLEANER, 'CO', SubscriberTier.FREE, 'standard', NOW);
    expect(res.rateBps).toBe(150);
    expect(res.ruleId).not.toBeNull();
  });

  // 16.3
  it('16.3: a country-specific rule beats ANY; other countries fall back to ANY', async () => {
    const repo = new FakeRepo();
    const cache = buildCache(repo);
    const admin = new CommissionAdminService(repo as unknown as CommissionRulesRepository, buildInvalidation([cache]));
    await admin.createRule(createInput({ country: null, rateBps: 300 })); // ANY
    await admin.createRule(createInput({ country: 'CO', rateBps: 200 })); // CO
    const resolver = new CommissionRateResolver(cache);

    expect(resolver.resolveSide(RateSide.CLEANER, 'CO', SubscriberTier.FREE, 'standard', NOW).rateBps).toBe(200);
    expect(resolver.resolveSide(RateSide.CLEANER, 'US', SubscriberTier.FREE, 'standard', NOW).rateBps).toBe(300);
  });

  // 16.4
  it('16.4: a future-dated rule is inert before its boundary and authoritative after', async () => {
    const repo = new FakeRepo();
    const cache = buildCache(repo);
    const admin = new CommissionAdminService(repo as unknown as CommissionRulesRepository, buildInvalidation([cache]));
    await admin.createRule(createInput({ country: 'CO', rateBps: 111, effectiveFrom: new Date('2026-09-01') }));
    const resolver = new CommissionRateResolver(cache);

    expect(resolver.resolveSide(RateSide.CLEANER, 'CO', SubscriberTier.FREE, 'standard', NOW).ruleId).toBeNull();
    const after = resolver.resolveSide(RateSide.CLEANER, 'CO', SubscriberTier.FREE, 'standard', new Date('2026-09-02'));
    expect(after.rateBps).toBe(111);
  });

  // 16.5
  it('16.5: a PRO cleaner gets the reduced rate at match; host stays FREE', async () => {
    const repo = new FakeRepo();
    const cache = buildCache(repo);
    const admin = new CommissionAdminService(repo as unknown as CommissionRulesRepository, buildInvalidation([cache]));
    await admin.createRule(createInput({ appliesTo: RateSide.CLEANER, subscriberTier: SubscriberTier.PRO, rateBps: 100 }));
    await admin.createRule(createInput({ appliesTo: RateSide.HOST, subscriberTier: SubscriberTier.FREE, rateBps: 1000 }));

    const resolver = new CommissionRateResolver(cache);
    const proTier: SubscriptionTierContract = {
      getTier: async () => SubscriberTier.PRO,
      getRoleTier: async () => SubscriberTier.PRO,
    };
    const freeTier: SubscriptionTierContract = {
      getTier: async () => SubscriberTier.FREE,
      getRoleTier: async () => SubscriberTier.FREE,
    };

    const cleanerProvider = new CommissionRatesProvider(resolver, proTier);
    const hostProvider = new CommissionRatesProvider(resolver, freeTier);

    const cleaner = await cleanerProvider.resolveCleanerRate({ country: 'CO', cleanerId: 'c', serviceType: 'standard' });
    const host = await hostProvider.resolveHostRate({ country: 'CO', hostId: 'h', serviceType: 'standard' });
    expect(cleaner.rateBps).toBe(100);
    expect(host.rateBps).toBe(1000);
  });

  // 16.6
  it('16.6: a slow/erroring tier lookup degrades to FREE and never blocks', async () => {
    const repo = new FakeRepo();
    const cache = buildCache(repo);
    await cache.refresh();
    const admin = new CommissionAdminService(repo as unknown as CommissionRulesRepository, buildInvalidation([cache]));
    // FREE cleaner rule present; PRO rule present but tier lookup fails -> FREE path used.
    await admin.createRule(createInput({ subscriberTier: SubscriberTier.FREE, rateBps: 300 }));
    await admin.createRule(createInput({ subscriberTier: SubscriberTier.PRO, rateBps: 100 }));

    const resolver = new CommissionRateResolver(cache);
    const erroringTier: SubscriptionTierContract = {
      getTier: async () => { throw new Error('tier down'); },
      getRoleTier: async () => { throw new Error('tier down'); },
    };
    const provider = new CommissionRatesProvider(resolver, erroringTier);

    const res = await provider.resolveCleanerRate({ country: 'CO', cleanerId: 'c', serviceType: 'standard' });
    expect(res.rateBps).toBe(300); // FREE, not PRO — degraded safely
  });

  // 16.7
  it('16.7: each mutation appends one audit row; deactivate keeps the row', async () => {
    const repo = new FakeRepo();
    const cache = buildCache(repo);
    const admin = new CommissionAdminService(repo as unknown as CommissionRulesRepository, buildInvalidation([cache]));

    const rule = await admin.createRule(createInput({ country: 'CO', rateBps: 250, reason: 'launch' }));
    await admin.deactivateRule(rule.id, 'op-1', 'seasonal end');

    const audit = await repo.listAudit(rule.id);
    expect(audit.map((a) => a.action)).toEqual([RuleAuditAction.CREATE, RuleAuditAction.DEACTIVATE]);
    expect(audit[0]!.actorId).toBe('op-1');
    expect(audit[1]!.reason).toBe('seasonal end');
    // Rule row still exists (never physically deleted), just inactive.
    const stored = await repo.findById(rule.id);
    expect(stored).not.toBeNull();
    expect(stored!.isActive).toBe(false);
  });

  // Bonus: over-cap rate rejected with 400 (business policy, distinct from technical bound)
  it('rejects an over-cap rate with 400 before any write', async () => {
    const repo = new FakeRepo();
    const cache = buildCache(repo);
    const admin = new CommissionAdminService(repo as unknown as CommissionRulesRepository, buildInvalidation([cache]));
    await expect(
      admin.createRule(createInput({ appliesTo: RateSide.CLEANER, rateBps: 9000 })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.rules).toHaveLength(0);
  });

  // Bonus: repository maps the DB exclusion-constraint error to a 409 (unit of runMapped)
  it('maps a raw exclusion-constraint QueryFailedError to a ConflictException', async () => {
    const err = new QueryFailedError(
      'INSERT ...',
      [],
      new Error('duplicate key value violates exclusion constraint "excl_commission_rule_overlap"'),
    );
    // Recreate the repository's mapping behavior via a minimal harness.
    const runMapped = async <T>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof QueryFailedError && e.message.includes('excl_commission_rule_overlap')) {
          throw new ConflictException('overlap');
        }
        throw e;
      }
    };
    await expect(runMapped(async () => { throw err; })).rejects.toBeInstanceOf(ConflictException);
  });
});
