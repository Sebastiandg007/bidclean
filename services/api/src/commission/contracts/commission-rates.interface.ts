import {
  CleanerRateContext,
  HostRateContext,
  ResolvedRate,
} from '../commission.types';

/**
 * Commission rate contract.
 *
 * Consumed by offer-publishing (Host fee at offer creation) and offer-negotiation
 * (Cleaner commission at match). commission-system returns basis points only; each
 * consumer computes cents with its OWN CommissionService. Coupling is one-directional
 * via this token — commission-system never depends on the consumer modules.
 *
 * `resolve*` operations are authoritative (snapshotted by the consumer). `preview*`
 * operations are informational and MUST NOT be treated as a reservation — a rule change
 * between preview and the authoritative moment may change the outcome.
 *
 * No operation ever throws; on any failure it degrades to the env-default rate.
 */
export interface CommissionRateContract {
  /** Authoritative Host fee resolution at offer creation. */
  resolveHostRate(ctx: HostRateContext): Promise<ResolvedRate>;
  /** Authoritative Cleaner commission resolution at match. */
  resolveCleanerRate(ctx: CleanerRateContext): Promise<ResolvedRate>;
  /** Informational Host-fee preview (non-freezing). */
  previewHostRate(ctx: HostRateContext): Promise<ResolvedRate>;
  /** Informational Cleaner-commission preview (non-freezing). */
  previewCleanerRate(ctx: CleanerRateContext): Promise<ResolvedRate>;
}

/** DI token for CommissionRateContract */
export const COMMISSION_RATES = Symbol('COMMISSION_RATES');
