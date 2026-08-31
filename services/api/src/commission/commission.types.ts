/**
 * Commission-system domain types.
 *
 * commission-system RESOLVES which rate applies to each side; it never computes cents.
 * Currency is intentionally excluded from resolution contexts in v1 (rates are
 * currency-independent basis points; a country implies its currency).
 */

/** Subscriber tier used to scope commission rules. */
export const SubscriberTier = { FREE: 'FREE', PRO: 'PRO' } as const;
export type SubscriberTier = (typeof SubscriberTier)[keyof typeof SubscriberTier];

/** The side of the service a rule/resolution applies to. */
export const RateSide = { HOST: 'HOST', CLEANER: 'CLEANER' } as const;
export type RateSide = (typeof RateSide)[keyof typeof RateSide];

/** Audit action recorded for every rule mutation. */
export const RuleAuditAction = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  ACTIVATE: 'ACTIVATE',
  DEACTIVATE: 'DEACTIVATE',
} as const;
export type RuleAuditAction = (typeof RuleAuditAction)[keyof typeof RuleAuditAction];

/**
 * Host resolution context (resolved at offer creation — the Host is known).
 */
export interface HostRateContext {
  /** ISO 3166-1 alpha-2 country of the property. */
  readonly country: string;
  /** The Host user id. */
  readonly hostId: string;
  /** The offer service type. */
  readonly serviceType: string;
}

/**
 * Cleaner resolution context (resolved at match — the winning Cleaner is known).
 */
export interface CleanerRateContext {
  /** ISO 3166-1 alpha-2 country of the property. */
  readonly country: string;
  /** The winning Cleaner user id. */
  readonly cleanerId: string;
  /** The offer service type. */
  readonly serviceType: string;
}

/**
 * One resolved side. commission-system returns basis points only; the consuming
 * module computes cents with its own CommissionService.
 */
export interface ResolvedRate {
  /** Effective rate in basis points (non-negative integer <= 10000). */
  readonly rateBps: number;
  /** Id of the rule that produced the rate, or null when the env default was used. */
  readonly ruleId: string | null;
}

/**
 * A commission rule as consumed by the resolver (scope + rate + window).
 * Mirrors the persisted row; NULL scope columns mean "ANY".
 */
export interface CommissionRuleRow {
  readonly id: string;
  readonly country: string | null;
  readonly subscriberTier: SubscriberTier | null;
  readonly serviceType: string | null;
  readonly appliesTo: RateSide;
  readonly rateBps: number;
  readonly priority: number;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly isActive: boolean;
}
