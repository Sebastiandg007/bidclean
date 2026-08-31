import { BadRequestException, ConflictException } from '@nestjs/common';
import { CommissionAdminService } from '../admin/commission-admin.service';
import { CommissionRulesRepository } from '../commission-rules.repository';
import { CommissionCacheInvalidation } from '../commission-cache-invalidation';
import { RateSide, SubscriberTier } from '../commission.types';

/**
 * Unit tests for CommissionAdminService.
 *
 * Feature: commission-system
 * Validates: Requirements 5.10 (business cap -> 400), 5.4 (overlap -> 409 propagated),
 * 6.1 (mutation triggers invalidation), 5.9 (deactivate keeps row).
 */
describe('CommissionAdminService', () => {
  let repo: jest.Mocked<CommissionRulesRepository>;
  let invalidation: jest.Mocked<CommissionCacheInvalidation>;
  let service: CommissionAdminService;

  const baseCreate = {
    country: null,
    subscriberTier: null,
    serviceType: null,
    appliesTo: RateSide.CLEANER,
    rateBps: 300,
    priority: 0,
    effectiveFrom: new Date('2026-01-01'),
    effectiveTo: null,
    actorId: 'admin-1',
    reason: null,
  };

  beforeEach(() => {
    repo = {
      createRule: jest.fn().mockResolvedValue({ id: 'rule-1' }),
      updateRule: jest.fn().mockResolvedValue({ id: 'rule-1' }),
      setActive: jest.fn().mockResolvedValue({ id: 'rule-1', isActive: false }),
      list: jest.fn().mockResolvedValue([]),
      listAudit: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue({ id: 'rule-1', appliesTo: RateSide.CLEANER }),
    } as unknown as jest.Mocked<CommissionRulesRepository>;
    invalidation = {
      publishInvalidation: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CommissionCacheInvalidation>;
    service = new CommissionAdminService(repo, invalidation);
  });

  it('creates a rule and invalidates the cache', async () => {
    await service.createRule(baseCreate);
    expect(repo.createRule).toHaveBeenCalledWith(baseCreate);
    expect(invalidation.publishInvalidation).toHaveBeenCalledTimes(1);
  });

  it('rejects a rate above the business-policy cap with 400', async () => {
    await expect(
      service.createRule({ ...baseCreate, appliesTo: RateSide.CLEANER, rateBps: 9000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.createRule).not.toHaveBeenCalled();
    expect(invalidation.publishInvalidation).not.toHaveBeenCalled();
  });

  it('rejects a rate outside the technical [0,10000] bound with 400', async () => {
    await expect(
      service.createRule({ ...baseCreate, rateBps: -1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createRule({ ...baseCreate, rateBps: 10001 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('propagates a repository overlap conflict (409) and does not invalidate', async () => {
    repo.createRule.mockRejectedValueOnce(new ConflictException('overlap'));
    await expect(service.createRule(baseCreate)).rejects.toBeInstanceOf(ConflictException);
    expect(invalidation.publishInvalidation).not.toHaveBeenCalled();
  });

  it('deactivates a rule (keeps the row) and invalidates', async () => {
    const rule = await service.deactivateRule('rule-1', 'admin-1', 'seasonal end');
    expect(repo.setActive).toHaveBeenCalledWith('rule-1', false, 'admin-1', 'seasonal end');
    expect(rule.isActive).toBe(false);
    expect(invalidation.publishInvalidation).toHaveBeenCalledTimes(1);
  });

  it('validates the cap against the resolved side on update when appliesTo is omitted', async () => {
    repo.findById.mockResolvedValueOnce({ id: 'rule-1', appliesTo: RateSide.HOST } as never);
    await service.updateRule('rule-1', { rateBps: 1200, actorId: 'admin-1', reason: null });
    expect(repo.findById).toHaveBeenCalledWith('rule-1');
    expect(repo.updateRule).toHaveBeenCalled();
  });

  it('does not require PRO tier to be stubbed to store a PRO-scoped rule', async () => {
    await service.createRule({ ...baseCreate, subscriberTier: SubscriberTier.PRO, rateBps: 100 });
    expect(repo.createRule).toHaveBeenCalled();
  });
});
