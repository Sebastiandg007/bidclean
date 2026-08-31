import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CommissionAdminController } from '../admin/commission-admin.controller';
import { CommissionAdminService } from '../admin/commission-admin.service';
import { CommissionAdminGuard } from '../guards/commission-admin.guard';
import { User } from '../../auth/entities/user.entity';
import { CreateRuleDto } from '../dto/create-rule.dto';
import { RateSide } from '../commission.types';
import { CommissionRule } from '../entities/commission-rule.entity';

/**
 * Unit tests for CommissionAdminController + CommissionAdminGuard.
 *
 * Feature: commission-system
 * Validates: Requirements 5.4 (create/list/audit wiring), 6.1 (audit history exposed),
 * Security (operator allowlist -> 403 for non-operators).
 */

function makeRule(overrides: Partial<CommissionRule> = {}): CommissionRule {
  const rule = new CommissionRule();
  Object.assign(rule, {
    id: 'rule-1',
    country: null,
    subscriberTier: null,
    serviceType: null,
    appliesTo: RateSide.CLEANER,
    rateBps: 300,
    priority: 0,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    effectiveTo: null,
    isActive: true,
    createdBy: 'u1',
    updatedBy: 'u1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  return Object.assign(rule, overrides);
}

describe('CommissionAdminGuard', () => {
  const ctx = (keycloakId?: string) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user: keycloakId ? { keycloakId } : undefined }) }),
    }) as never;

  afterEach(() => {
    delete process.env.COMMISSION_ADMIN_KEYCLOAK_IDS;
  });

  it('allows a keycloak id present in the allowlist', () => {
    process.env.COMMISSION_ADMIN_KEYCLOAK_IDS = 'op-1, op-2';
    const guard = new CommissionAdminGuard();
    expect(guard.canActivate(ctx('op-2'))).toBe(true);
  });

  it('rejects a keycloak id not in the allowlist (403)', () => {
    process.env.COMMISSION_ADMIN_KEYCLOAK_IDS = 'op-1';
    const guard = new CommissionAdminGuard();
    expect(() => guard.canActivate(ctx('intruder'))).toThrow(ForbiddenException);
  });

  it('rejects when the allowlist is empty', () => {
    const guard = new CommissionAdminGuard();
    expect(() => guard.canActivate(ctx('anyone'))).toThrow(ForbiddenException);
  });
});

describe('CommissionAdminController', () => {
  let service: jest.Mocked<CommissionAdminService>;
  let userRepo: jest.Mocked<Repository<User>>;
  let controller: CommissionAdminController;

  const req = { user: { keycloakId: 'kc-op' } } as never;

  beforeEach(() => {
    service = {
      createRule: jest.fn().mockResolvedValue(makeRule()),
      updateRule: jest.fn().mockResolvedValue(makeRule({ rateBps: 250 })),
      activateRule: jest.fn().mockResolvedValue(makeRule({ isActive: true })),
      deactivateRule: jest.fn().mockResolvedValue(makeRule({ isActive: false })),
      listRules: jest.fn().mockResolvedValue([makeRule()]),
      listAudit: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<CommissionAdminService>;
    userRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'user-op' }),
    } as unknown as jest.Mocked<Repository<User>>;
    controller = new CommissionAdminController(service, userRepo);
  });

  it('creates a rule, resolving the actor id from the JWT', async () => {
    const dto: CreateRuleDto = { appliesTo: RateSide.CLEANER, rateBps: 300 } as CreateRuleDto;
    const res = await controller.create(req, dto);
    expect(userRepo.findOne).toHaveBeenCalledWith({ where: { keycloakId: 'kc-op' } });
    expect(service.createRule).toHaveBeenCalledWith(
      expect.objectContaining({ appliesTo: RateSide.CLEANER, rateBps: 300, actorId: 'user-op' }),
    );
    expect(res.id).toBe('rule-1');
  });

  it('deactivates a rule and returns isActive=false', async () => {
    const res = await controller.deactivate(req, 'rule-1', { reason: 'seasonal' });
    expect(service.deactivateRule).toHaveBeenCalledWith('rule-1', 'user-op', 'seasonal');
    expect(res.isActive).toBe(false);
  });

  it('lists rules with parsed isActive filter', async () => {
    await controller.list({ appliesTo: RateSide.HOST, isActive: 'true' });
    expect(service.listRules).toHaveBeenCalledWith({ appliesTo: RateSide.HOST, isActive: true });
  });

  it('returns audit history for a rule', async () => {
    const res = await controller.audit('rule-1');
    expect(service.listAudit).toHaveBeenCalledWith('rule-1');
    expect(Array.isArray(res)).toBe(true);
  });
});
