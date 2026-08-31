import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CommissionRulesRepository,
  CreateRuleInput,
  UpdateRuleInput,
} from '../commission-rules.repository';
import { CommissionCacheInvalidation } from '../commission-cache-invalidation';
import { CommissionRule } from '../entities/commission-rule.entity';
import { CommissionRuleAudit } from '../entities/commission-rule-audit.entity';
import { BPS_MAX, maxRateBpsForSide } from '../commission.constants';
import { RateSide } from '../commission.types';

/**
 * Application service for commission-rule administration.
 *
 * Enforces the business-policy per-side rate cap (distinct from the technical [0, 10000]
 * bound), delegates the transactional rule+audit write to the repository, and triggers
 * local + distributed cache invalidation after every mutation so no API instance serves a
 * stale rate. Overlap conflicts surface as 409 from the repository's constraint mapping.
 */
@Injectable()
export class CommissionAdminService {
  constructor(
    private readonly repo: CommissionRulesRepository,
    private readonly invalidation: CommissionCacheInvalidation,
  ) {}

  async createRule(input: CreateRuleInput): Promise<CommissionRule> {
    this.assertRateWithinPolicy(input.appliesTo, input.rateBps);
    const rule = await this.repo.createRule(input);
    await this.invalidation.publishInvalidation();
    return rule;
  }

  async updateRule(id: string, input: UpdateRuleInput): Promise<CommissionRule> {
    if (input.rateBps !== undefined) {
      // Determine the side the rate applies to (either the new one or the existing one).
      const side = input.appliesTo ?? (await this.resolveSide(id));
      this.assertRateWithinPolicy(side, input.rateBps);
    }
    const rule = await this.repo.updateRule(id, input);
    await this.invalidation.publishInvalidation();
    return rule;
  }

  async activateRule(id: string, actorId: string | null, reason: string | null): Promise<CommissionRule> {
    const rule = await this.repo.setActive(id, true, actorId, reason);
    await this.invalidation.publishInvalidation();
    return rule;
  }

  async deactivateRule(id: string, actorId: string | null, reason: string | null): Promise<CommissionRule> {
    const rule = await this.repo.setActive(id, false, actorId, reason);
    await this.invalidation.publishInvalidation();
    return rule;
  }

  async listRules(filters: { appliesTo?: RateSide; isActive?: boolean }): Promise<CommissionRule[]> {
    return this.repo.list(filters);
  }

  async listAudit(ruleId: string): Promise<CommissionRuleAudit[]> {
    return this.repo.listAudit(ruleId);
  }

  /** Enforce the technical bound and the configurable business-policy cap for a side. */
  private assertRateWithinPolicy(side: RateSide, rateBps: number): void {
    if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > BPS_MAX) {
      throw new BadRequestException(`rateBps must be an integer in [0, ${BPS_MAX}], got ${rateBps}`);
    }
    const cap = maxRateBpsForSide(side);
    if (rateBps > cap) {
      throw new BadRequestException(
        `rateBps ${rateBps} exceeds the business-policy cap for ${side} (${cap})`,
      );
    }
  }

  private async resolveSide(id: string): Promise<RateSide> {
    const existing = await this.repo.findById(id);
    if (!existing) {
      throw new BadRequestException(`Commission rule ${id} not found`);
    }
    return existing.appliesTo;
  }
}
