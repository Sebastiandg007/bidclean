import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { CommissionRule } from './entities/commission-rule.entity';
import { CommissionRuleAudit } from './entities/commission-rule-audit.entity';
import {
  CommissionRuleRow,
  RateSide,
  RuleAuditAction,
  SubscriberTier,
} from './commission.types';

/** Fields accepted when creating a commission rule. */
export interface CreateRuleInput {
  readonly country: string | null;
  readonly subscriberTier: SubscriberTier | null;
  readonly serviceType: string | null;
  readonly appliesTo: RateSide;
  readonly rateBps: number;
  readonly priority: number;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly actorId: string | null;
  readonly reason: string | null;
}

/** Mutable fields accepted when updating a commission rule. */
export interface UpdateRuleInput {
  readonly country?: string | null;
  readonly subscriberTier?: SubscriberTier | null;
  readonly serviceType?: string | null;
  readonly appliesTo?: RateSide;
  readonly rateBps?: number;
  readonly priority?: number;
  readonly effectiveFrom?: Date;
  readonly effectiveTo?: Date | null;
  readonly actorId: string | null;
  readonly reason: string | null;
}

/** The exclusion-constraint name from the migration (overlap conflict). */
const OVERLAP_CONSTRAINT = 'excl_commission_rule_overlap';

/**
 * Owns all reads/writes to `commission_rules` and `commission_rule_audit`.
 *
 * Every mutation (create/update/activate/deactivate) writes the rule row AND appends an
 * immutable audit row inside ONE transaction. A GiST exclusion-constraint violation (two
 * active rules with identical scope + overlapping windows) is mapped to a 409. Rules are
 * never physically deleted. The active-rules loader feeds the in-memory cache.
 */
@Injectable()
export class CommissionRulesRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Load every currently-active rule as plain rows for the cache. */
  async loadActiveRules(): Promise<CommissionRuleRow[]> {
    const rules = await this.dataSource.getRepository(CommissionRule).find({
      where: { isActive: true },
    });
    return rules.map((r) => this.toRow(r));
  }

  /** Find a rule by id (or null). */
  async findById(id: string): Promise<CommissionRule | null> {
    return this.dataSource.getRepository(CommissionRule).findOne({ where: { id } });
  }

  /** List rules with optional filters (admin view). */
  async list(filters: {
    appliesTo?: RateSide;
    isActive?: boolean;
  }): Promise<CommissionRule[]> {
    const where: Record<string, unknown> = {};
    if (filters.appliesTo !== undefined) {
      where.appliesTo = filters.appliesTo;
    }
    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }
    return this.dataSource.getRepository(CommissionRule).find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  /** Audit history for a rule, newest first. */
  async listAudit(ruleId: string): Promise<CommissionRuleAudit[]> {
    return this.dataSource.getRepository(CommissionRuleAudit).find({
      where: { ruleId },
      order: { createdAt: 'DESC' },
    });
  }

  /** Create a rule + CREATE audit row in one transaction. */
  async createRule(input: CreateRuleInput): Promise<CommissionRule> {
    return this.runMapped(() =>
      this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(CommissionRule);
        const rule = repo.create({
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
        });
        const saved = await repo.save(rule);
        await this.appendAudit(manager, {
          ruleId: saved.id,
          action: RuleAuditAction.CREATE,
          actorId: input.actorId,
          oldValues: null,
          newValues: this.snapshot(saved),
          reason: input.reason,
        });
        return saved;
      }),
    );
  }

  /** Update a rule's mutable fields + UPDATE audit row in one transaction. */
  async updateRule(id: string, input: UpdateRuleInput): Promise<CommissionRule> {
    return this.runMapped(() =>
      this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(CommissionRule);
        const existing = await repo.findOne({ where: { id } });
        if (!existing) {
          throw new ConflictException(`Commission rule ${id} not found`);
        }
        const before = this.snapshot(existing);

        if (input.country !== undefined) existing.country = input.country;
        if (input.subscriberTier !== undefined) existing.subscriberTier = input.subscriberTier;
        if (input.serviceType !== undefined) existing.serviceType = input.serviceType;
        if (input.appliesTo !== undefined) existing.appliesTo = input.appliesTo;
        if (input.rateBps !== undefined) existing.rateBps = input.rateBps;
        if (input.priority !== undefined) existing.priority = input.priority;
        if (input.effectiveFrom !== undefined) existing.effectiveFrom = input.effectiveFrom;
        if (input.effectiveTo !== undefined) existing.effectiveTo = input.effectiveTo;
        existing.updatedBy = input.actorId;

        const saved = await repo.save(existing);
        await this.appendAudit(manager, {
          ruleId: saved.id,
          action: RuleAuditAction.UPDATE,
          actorId: input.actorId,
          oldValues: before,
          newValues: this.snapshot(saved),
          reason: input.reason,
        });
        return saved;
      }),
    );
  }

  /** Flip is_active and append ACTIVATE/DEACTIVATE audit in one transaction. */
  async setActive(
    id: string,
    isActive: boolean,
    actorId: string | null,
    reason: string | null,
  ): Promise<CommissionRule> {
    return this.runMapped(() =>
      this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(CommissionRule);
        const existing = await repo.findOne({ where: { id } });
        if (!existing) {
          throw new ConflictException(`Commission rule ${id} not found`);
        }
        const before = this.snapshot(existing);
        existing.isActive = isActive;
        existing.updatedBy = actorId;
        const saved = await repo.save(existing);
        await this.appendAudit(manager, {
          ruleId: saved.id,
          action: isActive ? RuleAuditAction.ACTIVATE : RuleAuditAction.DEACTIVATE,
          actorId,
          oldValues: before,
          newValues: this.snapshot(saved),
          reason,
        });
        return saved;
      }),
    );
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  /** Append one immutable audit row. */
  private async appendAudit(
    manager: EntityManager,
    row: {
      ruleId: string;
      action: RuleAuditAction;
      actorId: string | null;
      oldValues: Record<string, unknown> | null;
      newValues: Record<string, unknown>;
      reason: string | null;
    },
  ): Promise<void> {
    const auditRepo = manager.getRepository(CommissionRuleAudit);
    await auditRepo.save(
      auditRepo.create({
        ruleId: row.ruleId,
        action: row.action,
        actorId: row.actorId,
        oldValues: row.oldValues,
        newValues: row.newValues,
        reason: row.reason,
      }),
    );
  }

  /** Sanitized snapshot stored in audit old/new_values (scope + rate bps + window + flags). */
  private snapshot(rule: CommissionRule): Record<string, unknown> {
    return {
      country: rule.country,
      subscriberTier: rule.subscriberTier,
      serviceType: rule.serviceType,
      appliesTo: rule.appliesTo,
      rateBps: rule.rateBps,
      priority: rule.priority,
      effectiveFrom: rule.effectiveFrom,
      effectiveTo: rule.effectiveTo,
      isActive: rule.isActive,
    };
  }

  /** Map an overlap exclusion-constraint violation to a 409 Conflict. */
  private async runMapped<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        typeof error.message === 'string' &&
        error.message.includes(OVERLAP_CONSTRAINT)
      ) {
        throw new ConflictException(
          'A conflicting active commission rule with overlapping scope and effective window already exists',
        );
      }
      throw error;
    }
  }

  private toRow(rule: CommissionRule): CommissionRuleRow {
    return {
      id: rule.id,
      country: rule.country,
      subscriberTier: rule.subscriberTier,
      serviceType: rule.serviceType,
      appliesTo: rule.appliesTo,
      rateBps: rule.rateBps,
      priority: rule.priority,
      effectiveFrom: rule.effectiveFrom,
      effectiveTo: rule.effectiveTo,
      isActive: rule.isActive,
    };
  }
}
