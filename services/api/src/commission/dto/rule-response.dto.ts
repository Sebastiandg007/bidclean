import { CommissionRule } from '../entities/commission-rule.entity';
import { CommissionRuleAudit } from '../entities/commission-rule-audit.entity';

/** API view of a commission rule. */
export interface RuleResponse {
  readonly id: string;
  readonly country: string | null;
  readonly subscriberTier: string | null;
  readonly serviceType: string | null;
  readonly appliesTo: string;
  readonly rateBps: number;
  readonly priority: number;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly isActive: boolean;
  readonly createdBy: string | null;
  readonly updatedBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** API view of an audit row. */
export interface RuleAuditResponse {
  readonly id: string;
  readonly ruleId: string;
  readonly action: string;
  readonly actorId: string | null;
  readonly oldValues: Record<string, unknown> | null;
  readonly newValues: Record<string, unknown>;
  readonly reason: string | null;
  readonly createdAt: string;
}

/** Map a rule entity to its API view. */
export function toRuleResponse(rule: CommissionRule): RuleResponse {
  return {
    id: rule.id,
    country: rule.country,
    subscriberTier: rule.subscriberTier,
    serviceType: rule.serviceType,
    appliesTo: rule.appliesTo,
    rateBps: rule.rateBps,
    priority: rule.priority,
    effectiveFrom: rule.effectiveFrom.toISOString(),
    effectiveTo: rule.effectiveTo ? rule.effectiveTo.toISOString() : null,
    isActive: rule.isActive,
    createdBy: rule.createdBy,
    updatedBy: rule.updatedBy,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
}

/** Map an audit entity to its API view. */
export function toRuleAuditResponse(audit: CommissionRuleAudit): RuleAuditResponse {
  return {
    id: audit.id,
    ruleId: audit.ruleId,
    action: audit.action,
    actorId: audit.actorId,
    oldValues: audit.oldValues,
    newValues: audit.newValues,
    reason: audit.reason,
    createdAt: audit.createdAt.toISOString(),
  };
}
