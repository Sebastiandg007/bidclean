import { DataSource } from 'typeorm';
import { SubscriptionsRepository } from '../subscriptions.repository';
import { RealSubscriptionTierService } from '../subscription-tier.service';
import { SubscriptionsService } from '../subscriptions.service';
import { SubscriptionReconciliationService } from '../reconciliation/subscription-reconciliation.service';
import { mapEventToDeltas } from '../revenuecat/revenuecat-event.mapper';
import { sanitizeRevenueCatEvent } from '../revenuecat/revenuecat-payload.sanitizer';
import { RevenueCatClient, type RevenueCatSubscriber } from '../revenuecat/revenuecat.client';
import { EntitlementKey, Store } from '../subscriptions.types';
import { InMemoryDataSource } from './support/in-memory-data-source';
import { CommissionRatesProvider } from '../../commission/commission-rates.provider';
import { CommissionRateResolver } from '../../commission/rate-resolver.service';
import { CommissionRulesCache } from '../../commission/commission-rules.cache';
import {
  CommissionRuleRow,
  RateSide,
  SubscriberTier as CommissionTier,
} from '../../commission/commission.types';

/**
 * Integration & scenario tests wiring the REAL subscription modules together over an in-memory
 * DataSource + fake RevenueCat client (no live infra).
 *
 * Feature: revenuecat-subscriptions
 * Validates end-to-end: purchase webhook -> mirror -> commission PRO at match (19.1); host-only
 * PRO -> Cleaner FREE / Host PRO (19.2); expiration -> FREE (19.3); recovery of an un-enqueued
 * event (19.4); interleaved out-of-order A/B (19.5); TRANSFER moves the entitlement (19.6);
 * missed webhook -> reconciliation heals + discovers (19.7); account deletion cleanup +
 * empty-mirror reproduces flat commission (19.8).
 */

const FUTURE_MS = Date.now() + 30 * 86_400_000;

function build(): {
  repo: SubscriptionsRepository;
  fake: InMemoryDataSource;
  tierService: RealSubscriptionTierService;
} {
  const fake = new InMemoryDataSource();
  const repo = new SubscriptionsRepository(fake as unknown as DataSource);
  return { repo, fake, tierService: new RealSubscriptionTierService(repo) };
}

/** Ingest a webhook end-to-end: sanitize -> map -> applyDeltas (as the processor does). */
async function ingest(repo: SubscriptionsRepository, rawEvent: Record<string, unknown>): Promise<void> {
  const sanitized = sanitizeRevenueCatEvent({ event: rawEvent });
  const ledgerId = await repo.appendEvent({
    revenuecatEventId: sanitized.eventId ?? 'evt',
    userId: sanitized.appUserId,
    eventType: sanitized.type ?? 'UNKNOWN',
    entitlementIds: sanitized.entitlementIds,
    store: (sanitized.store as Store | null) ?? null,
    eventTimestampMs: sanitized.eventTimestampMs ?? Date.now(),
    expirationAt: sanitized.expirationAtMs !== null ? new Date(sanitized.expirationAtMs) : null,
    payload: { ...sanitized },
  });
  await repo.applyDeltas(mapEventToDeltas(sanitized), ledgerId);
}

function purchaseEvent(entitlement: string, userId: string, tsMs: number): Record<string, unknown> {
  return {
    id: `evt-${entitlement}-${tsMs}`,
    type: 'INITIAL_PURCHASE',
    app_user_id: userId,
    entitlement_ids: [entitlement],
    store: 'app_store',
    event_timestamp_ms: tsMs,
    expiration_at_ms: FUTURE_MS,
  };
}

/** A commission provider wired to the REAL tier service over the given repo. */
function commissionWith(
  tierService: RealSubscriptionTierService,
  rules: CommissionRuleRow[],
): CommissionRatesProvider {
  const cache = { activeRules: () => rules } as unknown as CommissionRulesCache;
  const resolver = new CommissionRateResolver(cache);
  return new CommissionRatesProvider(resolver, tierService);
}

/** Cleaner rules: PRO pays 100 bps, FREE pays 300 bps (the PRO discount). */
const CLEANER_RULES: CommissionRuleRow[] = [
  rule('c-pro', RateSide.CLEANER, CommissionTier.PRO, 100),
  rule('c-free', RateSide.CLEANER, CommissionTier.FREE, 300),
];
/** Host rules: PRO pays 800 bps, FREE pays 1000 bps. */
const HOST_RULES: CommissionRuleRow[] = [
  rule('h-pro', RateSide.HOST, CommissionTier.PRO, 800),
  rule('h-free', RateSide.HOST, CommissionTier.FREE, 1000),
];

function rule(id: string, side: RateSide, tier: CommissionTier, rateBps: number): CommissionRuleRow {
  return {
    id,
    country: null,
    subscriberTier: tier,
    serviceType: null,
    appliesTo: side,
    rateBps,
    priority: 0,
    effectiveFrom: new Date(0),
    effectiveTo: null,
    isActive: true,
  };
}

describe('subscription scenarios (integration)', () => {
  it('19.1: purchase webhook -> mirror -> commission resolves the PRO cleaner rate at match', async () => {
    const { repo, tierService } = build();
    await ingest(repo, purchaseEvent('cleaner_pro', 'cleaner-1', 1000));

    const commission = commissionWith(tierService, CLEANER_RULES);
    const resolved = await commission.resolveCleanerRate({
      country: 'CO',
      cleanerId: 'cleaner-1',
      serviceType: 'standard',
    });
    expect(resolved.rateBps).toBe(100); // PRO discount applied
  });

  it('19.2: host-only PRO -> Host fee PRO, Cleaner commission FREE (the P0 case)', async () => {
    const { repo, tierService } = build();
    await ingest(repo, purchaseEvent('host_pro', 'user-1', 1000));

    const hostCommission = commissionWith(tierService, HOST_RULES);
    const cleanerCommission = commissionWith(tierService, CLEANER_RULES);
    const host = await hostCommission.resolveHostRate({ country: 'CO', hostId: 'user-1', serviceType: 'standard' });
    const cleaner = await cleanerCommission.resolveCleanerRate({ country: 'CO', cleanerId: 'user-1', serviceType: 'standard' });

    expect(host.rateBps).toBe(800); // Host PRO
    expect(cleaner.rateBps).toBe(300); // Cleaner FREE (same user, other role)
  });

  it('19.3: expiration -> the cleaner tier resolves FREE', async () => {
    const { repo, tierService } = build();
    await ingest(repo, purchaseEvent('cleaner_pro', 'cleaner-1', 1000));
    await ingest(repo, {
      id: 'evt-exp',
      type: 'EXPIRATION',
      app_user_id: 'cleaner-1',
      entitlement_ids: ['cleaner_pro'],
      store: 'app_store',
      event_timestamp_ms: 2000,
      expiration_at_ms: Date.now() - 1000,
    });

    const commission = commissionWith(tierService, CLEANER_RULES);
    const resolved = await commission.resolveCleanerRate({ country: 'CO', cleanerId: 'cleaner-1', serviceType: 'standard' });
    expect(resolved.rateBps).toBe(300); // FREE after expiration
  });

  it('19.4: an un-enqueued RECEIVED event is recovered and then applied', async () => {
    const { repo, fake } = build();
    // Simulate the controller committing RECEIVED but the enqueue failing (no processing yet).
    const ledgerId = await repo.appendEvent({
      revenuecatEventId: 'evt-orphan',
      userId: 'cleaner-1',
      eventType: 'INITIAL_PURCHASE',
      entitlementIds: ['cleaner_pro'],
      store: Store.APP_STORE,
      eventTimestampMs: 1000,
      expirationAt: new Date(FUTURE_MS),
      payload: {
        eventId: 'evt-orphan',
        type: 'INITIAL_PURCHASE',
        appUserId: 'cleaner-1',
        entitlementIds: ['cleaner_pro'],
        store: 'app_store',
        eventTimestampMs: 1000,
        expirationAtMs: FUTURE_MS,
      },
    });
    const row = fake.events.find((e) => e.id === ledgerId);
    if (row) {
      row.createdAt = new Date(Date.now() - 120_000);
    }

    // The recovery worker would find this and re-enqueue; the processor then applies it.
    const recovered = await repo.findRecovered(60_000, 10);
    expect(recovered.map((r) => r.id)).toContain(ledgerId);
    const orphan = recovered[0]!;
    await repo.applyDeltas(
      mapEventToDeltas(orphan.payloadJson as never),
      orphan.id,
    );

    const mirror = await repo.findByUserId('cleaner-1');
    expect(mirror?.cleanerProActive).toBe(true);
  });

  it('19.5: interleaved out-of-order A/B — a late host event is not dropped by a newer cleaner event', async () => {
    const { repo, tierService } = build();
    // Newer cleaner event first, then an older host event.
    await ingest(repo, purchaseEvent('cleaner_pro', 'user-1', 5000));
    await ingest(repo, purchaseEvent('host_pro', 'user-1', 3000));

    expect(await tierService.getTier('user-1')).toBe(CommissionTier.PRO);
    const mirror = await repo.findByUserId('user-1');
    expect(mirror?.cleanerProActive).toBe(true);
    expect(mirror?.hostProActive).toBe(true);
  });

  it('19.6: TRANSFER moves the entitlement to the destination only', async () => {
    const { repo } = build();
    await ingest(repo, purchaseEvent('host_pro', 'src', 1000));
    await ingest(repo, {
      id: 'evt-transfer',
      type: 'TRANSFER',
      entitlement_ids: ['host_pro'],
      transferred_from: ['src'],
      transferred_to: ['dst'],
      store: 'app_store',
      event_timestamp_ms: 2000,
      expiration_at_ms: FUTURE_MS,
    });

    const source = await repo.findByUserId('src');
    const destination = await repo.findByUserId('dst');
    expect(source?.hostProActive).toBe(false);
    expect(destination?.hostProActive).toBe(true);
  });

  it('19.7: a missed webhook is healed by reconciliation, which also discovers a missing row', async () => {
    const { repo, tierService } = build();
    // No webhook arrives; RevenueCat is the source of truth.
    const snapshot: RevenueCatSubscriber = {
      userId: 'ghost',
      entitlements: [
        { key: EntitlementKey.CLEANER_PRO, active: true, expiresAt: new Date(FUTURE_MS), store: Store.APP_STORE },
      ],
    };
    const client = { getSubscriber: async () => snapshot } as unknown as RevenueCatClient;
    const reconciliation = new SubscriptionReconciliationService(repo, client);

    expect(await repo.findByUserId('ghost')).toBeNull();
    await reconciliation.reconcileUser('ghost'); // discovery + converge

    expect(await tierService.getRoleTier('ghost', 'CLEANER')).toBe(CommissionTier.PRO);
  });

  it('19.8: account deletion removes the mirror; an empty mirror reproduces flat FREE commission', async () => {
    const { repo, tierService } = build();
    await ingest(repo, purchaseEvent('cleaner_pro', 'cleaner-1', 1000));

    // Delete: remove the mirror row + anonymize the ledger (as the deletion cascade does).
    await repo.removeForUser('cleaner-1');
    await repo.anonymizeLedgerForUser('cleaner-1');

    expect(await repo.findByUserId('cleaner-1')).toBeNull();
    // With no mirror row, the cleaner commission reverts to the FREE rate (flat behavior).
    const commission = commissionWith(tierService, CLEANER_RULES);
    const resolved = await commission.resolveCleanerRate({ country: 'CO', cleanerId: 'cleaner-1', serviceType: 'standard' });
    expect(resolved.rateBps).toBe(300);
  });

  it('19.8b: SubscriptionsService returns FREE and triggers self-heal on a missing row', async () => {
    const { repo } = build();
    const reconcileUser = jest.fn().mockResolvedValue(undefined);
    const reconciliation = { reconcileUser } as unknown as SubscriptionReconciliationService;
    const service = new SubscriptionsService(repo, reconciliation);

    const view = await service.getMyEntitlements('nobody');
    expect(view.tier).toBe(CommissionTier.FREE);
    expect(reconcileUser).toHaveBeenCalledWith('nobody');
  });
});
